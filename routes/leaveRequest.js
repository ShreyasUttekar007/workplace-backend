const express = require("express");
const router = express.Router();
require("dotenv").config();
const Leave = require("../models/LeaveRequest");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const sgMail = require("@sendgrid/mail");
const EmployeeLeave = require("../models/EmployeeData");
const { applyLeaveStatus } = require("../utils/leaveStatus");
const { sendActionSummary } = require("../utils/leaveEmails");

router.use(authenticateUser);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

router.post("/leave", async (req, res) => {
  try {
    const momData = req.body;

    // Validate if req.user exists
    if (!req.user?.id) {
      return res.status(403).json({ error: "Unauthorized user" });
    }

    // Validate if userId exists in momData
    if (!momData.userId) {
      return res
        .status(400)
        .json({ error: "Missing userId in the request body" });
    }

    // Check if userId matches the logged-in user's _id
    if (momData.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    // Debug log — confirm what actually arrived on the server
    console.log("Leave payload RMs:", {
      receiverEmail: momData.receiverEmail,
      rm: momData.reportingManagerEmail,
      rm1: momData.reportingManagerEmail1,
      rm2: momData.reportingManagerEmail2,
      rm3: momData.reportingManagerEmail3,
      cc: momData.email,
    });

    // Create new leave request
    const newLeave = await Leave.create(momData);
    const documentUrl = momData.document || "No document provided";
    // Base URL the email Approve/Decline links point back to (the backend).
    // Set EMAIL_ACTION_BASE_URL in .env for production (e.g. https://showtimeconsulting.co.in).
    const actionBase =
      process.env.EMAIL_ACTION_BASE_URL || "http://localhost:5000";

    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-GB");
    };

    // Helper — normalise and validate an email
    const isValidEmail = (e) =>
      typeof e === "string" &&
      e.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

    const PORTAL = "stc.portal@showtimeconsulting.in";

    // The leave form's "Mail to" field (receiverEmail) is the PRIMARY reporting
    // manager. Fall back through the other manager fields so the buttoned email
    // always reaches someone who can action it.
    const primaryRM =
      [
        momData.receiverEmail,
        momData.reportingManagerEmail,
        momData.reportingManagerEmail1,
        momData.reportingManagerEmail2,
        momData.reportingManagerEmail3,
      ]
        .map((e) => (typeof e === "string" ? e.trim() : ""))
        .find((e) => isValidEmail(e)) || null;

    console.log(
      `Leave ${newLeave.leaveCode}: primary RM resolved as`,
      primaryRM || "(none — buttoned email will NOT be sent)",
      "| receiverEmail:",
      momData.receiverEmail || "(empty)",
    );

    const sharedHtml = `
        <p>Dear HR,</p>
        <p>
          I hope this message finds you well. I am writing to formally request leave from 
          <strong>${formatDate(momData.startDate)}</strong> to 
          <strong>${formatDate(momData.endDate)}</strong>. The type of leave I am requesting is 
          <strong>${momData.leaveType}</strong>.
        </p>
        <p><strong>Reason:</strong></p>
        <p>${momData.summaryForLeave}</p>
        <p>
          To support my request, you can find the relevant document at the following link:<br />
          <a href="${documentUrl}" target="_blank">Supporting Document</a>
        </p>
        <p>Thank you for your understanding and consideration.</p>
        <p>Best regards,<br />${momData.name}</p>`;

    const textBody = `Dear HR,

I hope this message finds you well. I am writing to formally request leave from ${formatDate(
      momData.startDate,
    )} to ${formatDate(momData.endDate)}. The type of leave I am requesting is ${momData.leaveType}.

Reason:
${momData.summaryForLeave}

To support my request, you can find the relevant document at the following link:
${documentUrl}

Thank you for your understanding and consideration.

Best regards,
${momData.name}`;

    const buttonsHtml = `
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 18px;" />
        <p style="margin:0 0 12px;color:#3a4a5e;font-size:14px;">
          <strong>Reporting Manager:</strong> you can action this request directly:
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:12px;">
            <a href="${actionBase}/api/leave-action/${newLeave._id}?action=approve&token=${newLeave.actionToken}"
               style="display:inline-block;background:#1f8a4c;color:#ffffff;text-decoration:none;
                      font-weight:700;padding:12px 28px;border-radius:8px;font-size:15px;">
              &#10003; Approve
            </a>
          </td>
          <td>
            <a href="${actionBase}/api/leave-action/${newLeave._id}?action=decline&token=${newLeave.actionToken}"
               style="display:inline-block;background:#b00020;color:#ffffff;text-decoration:none;
                      font-weight:700;padding:12px 28px;border-radius:8px;font-size:15px;">
              &#10005; Decline
            </a>
          </td>
        </tr></table>
        <p style="margin:14px 0 0;color:#8a97a8;font-size:12px;">
          The action you choose here is final and will be reflected on the STC Workplace portal automatically.
        </p>`;

    const subject = `Leave Request - ${momData.reasonForLeave} :: ${momData.name} :: ${newLeave.leaveCode}`;

    // 1) Buttoned email -> PRIMARY reporting manager ONLY
    if (primaryRM) {
      try {
        await sgMail.send({
          to: primaryRM,
          from: PORTAL,
          subject,
          text: textBody,
          html: sharedHtml + buttonsHtml,
        });
        console.log(`Buttoned leave email sent to primary RM: ${primaryRM}`);
      } catch (error) {
        console.error(
          "Failed to send buttoned email to primary RM:",
          error.response ? error.response.body : error.message,
        );
      }
    } else {
      console.warn(
        "No valid primary reporting manager — Approve/Decline email not sent.",
        { leaveCode: newLeave.leaveCode },
      );
    }

    // 2) Plain notification (NO buttons) -> applicant + portal + the ENTIRE
    //    reporting chain (all secondary reporting managers), so everyone in the
    //    chain is informed immediately. Only the PRIMARY RM gets the buttoned
    //    email above; everyone else gets this notification copy. The primary RM
    //    is excluded here so they don't get a duplicate.
    const plainSet = new Set();
    [
      momData.email,
      PORTAL,
      momData.reportingManagerEmail,
      momData.reportingManagerEmail1,
      momData.reportingManagerEmail2,
      momData.reportingManagerEmail3,
    ].forEach((e) => {
      if (
        isValidEmail(e) &&
        (!primaryRM || e.trim().toLowerCase() !== primaryRM.toLowerCase())
      ) {
        plainSet.add(e.trim());
      }
    });
    if (plainSet.size) {
      try {
        await sgMail.send({
          to: [...plainSet],
          from: PORTAL,
          subject: `Leave Request Submitted :: ${momData.name} :: ${newLeave.leaveCode}`,
          text:
            textBody +
            "\n\n(This is a notification copy. The primary reporting manager will approve or decline the request.)",
          html:
            sharedHtml +
            `<p style="color:#8a97a8;font-size:12px;margin-top:16px;">This is a notification copy for the reporting chain.${
              primaryRM
                ? " The primary reporting manager has been emailed to approve or decline this request."
                : ""
            }</p>`,
        });
        console.log(
          `Leave ${newLeave.leaveCode}: chain notified ->`,
          [...plainSet].join(", "),
        );
      } catch (error) {
        console.error(
          "Failed to send plain notification emails:",
          error.response ? error.response.body : error.message,
        );
      }
    }

    res.status(201).json(newLeave);
  } catch (error) {
    console.error("Error processing leave request:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/leave-requests", authenticateUser, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.userId; // Use `_id` or `userId` based on your user schema
    console.log("User Id: ", userId);

    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }

    // Fetch leave requests for the specific user
    const leaveRequests = await Leave.find({ userId }).sort({ createdAt: -1 });

    res.status(200).json({ leaveRequests });
  } catch (error) {
    console.error("Error fetching leave requests:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/leave-requests-emails", authenticateUser, async (req, res) => {
  try {
    const userRoles = req.user?.roles || []; // Extract roles from the authenticated user
    const userEmail = req.user?.email; // Extract the authenticated user's email
    const { startDate, endDate } = req.query; // Get date range from query params

    console.log("User Roles: ", userRoles);
    console.log("User Email: ", userEmail);
    console.log("Start Date: ", startDate);
    console.log("End Date: ", endDate);

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required." });
    }

    let filter = {};

    if (startDate && endDate) {
      filter = {
        $or: [
          {
            startDate: { $lte: new Date(endDate) },
            endDate: { $gte: new Date(startDate) },
          },
        ],
      };
    }

    let leaveRequests;

    if (userRoles.includes("admin")) {
      leaveRequests = await Leave.find(filter).sort({ createdAt: -1 });
    } else {
      leaveRequests = await Leave.find({
        receiverEmail: userEmail,
        ...filter,
      }).sort({ createdAt: -1 });
    }

    const leaveCount = leaveRequests.length; // Count of employees on leave

    res.status(200).json({ leaveRequests, leaveCount });
  } catch (error) {
    console.error("Error fetching leave requests by email:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get(
  "/leave-requests-reporting-manager",
  authenticateUser,
  async (req, res) => {
    try {
      const userEmail = req.user?.email; // Extract the authenticated user's email
      console.log("User Email: ", userEmail);

      if (!userEmail) {
        return res.status(400).json({ error: "User email is required." });
      }

      // Fetch leave requests where the user's email is mentioned in reportingManagerEmail
      const leaveRequests = await Leave.find({
        receiverEmail: userEmail,
      }).sort({ createdAt: -1 });

      res.status(200).json({ leaveRequests });
    } catch (error) {
      console.error(
        "Error fetching leave requests by reporting manager email:",
        error,
      );
      res.status(500).json({ error: "Internal server error." });
    }
  },
);

router.get("/get-leave", async (req, res) => {
  try {
    const moms = await Leave.find().populate("userId");
    res.status(200).json(moms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-leave-by-id/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    console.log("momId::: ", momId);
    const mom = await Leave.findById(momId).populate("userId");

    if (!mom) {
      return res.status(404).json({ error: "MOM not found" });
    }

    res.status(200).json(mom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-mom/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const updatedMom = await Leave.findByIdAndUpdate(momId, req.body, {
      new: true,
    });
    res.status(200).json(updatedMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-leave-status/:id", async (req, res) => {
  const { id } = req.params;
  const { leaveStatus } = req.body;

  try {
    const leaveRequest = await Leave.findById(id);
    if (!leaveRequest) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    const result = await applyLeaveStatus(leaveRequest, leaveStatus);

    // Notify secondary reporting manager(s) + applicant when actioned from the portal too.
    if (
      result.status !== "unchanged" &&
      (leaveStatus === "approved" || leaveStatus === "not approved")
    ) {
      await sendActionSummary(leaveRequest, leaveStatus);
    }

    return res.status(200).json({
      message: "Leave status updated",
      updatedData: result.leaveRequest,
    });
  } catch (error) {
    if (error.code === "NO_EMPLOYEE") {
      return res.status(404).json({ error: "Employee not found" });
    }
    if (error.code === "INVALID_TYPE") {
      return res.status(400).json({ error: "Invalid leave type" });
    }
    console.error("Error updating leave status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/delete-mom/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const deletedMom = await Leave.findByIdAndDelete(momId);
    if (!deletedMom) {
      return res.status(404).json({ error: "Leave record not found" });
    }
    res.status(200).json({ message: "Leave record deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
