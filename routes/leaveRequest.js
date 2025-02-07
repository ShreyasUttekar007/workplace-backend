const express = require("express");
const router = express.Router();
require("dotenv").config();
const Leave = require("../models/LeaveRequest");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const sgMail = require("@sendgrid/mail");
const EmployeeLeave = require("../models/EmployeeData");

router.use(authenticateUser);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

router.post("/leave", async (req, res) => {
  try {
    const momData = req.body;

    // Validate if req.user exists
    if (!req.user || !req.user._id) {
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

    // Create new leave request
    const newLeave = await Leave.create(momData);

    const documentUrl = momData.document || "No document provided"; // Use the document URL or a fallback message
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-GB"); // en-GB ensures dd/mm/yyyy format
    };

    const msg = {
      to: [
        momData.receiverEmail,
        "stc.portal@showtimeconsulting.in",
        "saumitra@showtimeconsulting.in",
        momData.reportingManagerEmail2,
      ], // Send to both receiver and HR
      from: "stc.portal@showtimeconsulting.in",
      cc: momData.email, // CC the sender's email
      subject: `Leave Request - ${momData.reasonForLeave} :: ${momData.name} :: ${newLeave.leaveCode}`, // Updated subject
      text: `Dear HR,

I hope this message finds you well. I am writing to formally request leave from ${formatDate(
        momData.startDate
      )} to ${formatDate(
        momData.endDate
      )}. The type of leave I am requesting is ${momData.leaveType}.

Reason: 
${momData.summaryForLeave}

To support my request, you can find the relevant document at the following link:
document

Thank you for your understanding and consideration.

Best regards,
${momData.name}`,
      html: `
    <p>Dear HR,</p>
    <p>
      I hope this message finds you well. I am writing to formally request leave from 
      <strong>${formatDate(momData.startDate)}</strong> to 
      <strong>${formatDate(
        momData.endDate
      )}</strong>. The type of leave I am requesting is 
      <strong>${momData.leaveType}</strong>.
    </p>
    <p><strong>Reason:</strong></p>
    <p>${momData.summaryForLeave}</p>
    <p>
      To support my request, you can find the relevant document at the following link:<br />
      <a href="${documentUrl}" target="_blank">Supporting Document</a>
    </p>
    <p>Thank you for your understanding and consideration.</p>
    <p>Best regards,<br />${momData.name}</p>
  `,
    };

    try {
      await sgMail.send(msg);
      console.log("Email sent successfully!");
    } catch (error) {
      console.error("Error sending email:", error);
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
          { startDate: { $lte: new Date(endDate) }, endDate: { $gte: new Date(startDate) } },
        ],
      };
    }

    let leaveRequests;
    
    if (userRoles.includes("admin")) {
      leaveRequests = await Leave.find(filter).sort({ createdAt: -1 });
    } else {
      leaveRequests = await Leave.find({ receiverEmail: userEmail, ...filter }).sort({ createdAt: -1 });
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
        error
      );
      res.status(500).json({ error: "Internal server error." });
    }
  }
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
    // Fetch the leave request by ID
    const leaveRequest = await Leave.findById(id);

    if (!leaveRequest) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    // If the status is not 'approved', only update the status and exit
    if (leaveStatus !== "approved") {
      leaveRequest.leaveStatus = leaveStatus;
      const updatedData = await leaveRequest.save();
      return res.status(200).json(updatedData);
    }

    // Fetch the employee's leave balance
    const employee = await EmployeeLeave.findOne({
      employeeEmail: { $regex: new RegExp(`^${leaveRequest.email}$`, "i") },
    });

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Calculate the number of leave days
    const startDate = new Date(leaveRequest.startDate);
    const endDate = new Date(leaveRequest.endDate);
    const leaveDays =
      Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    // Deduct/Add leave balance based on leave type
    switch (leaveRequest.leaveType) {
      case "paidLeave":
        if (employee.paidLeave >= leaveDays) {
          employee.paidLeave -= leaveDays; // Deduct directly
        } else {
          const remainingDays = leaveDays - employee.paidLeave;
          employee.paidLeave = 0; // Exhaust paid leave

          if (employee.sickLeave >= remainingDays) {
            employee.sickLeave -= remainingDays; // Deduct from sick leave if possible
          } else {
            const extraNeeded = remainingDays - employee.sickLeave;
            employee.sickLeave = 0; // Exhaust sick leave
            employee.paidLeave -= extraNeeded; // Go negative on paid leave
          }
        }
        break;

      case "sickLeave":
        if (employee.sickLeave >= leaveDays) {
          employee.sickLeave -= leaveDays; // Deduct directly
        } else {
          const remainingDays = leaveDays - employee.sickLeave;
          employee.sickLeave = 0; // Exhaust sick leave

          if (employee.paidLeave >= remainingDays) {
            employee.paidLeave -= remainingDays; // Deduct from paid leave if possible
          } else {
            const extraNeeded = remainingDays - employee.paidLeave;
            employee.paidLeave = 0; // Exhaust paid leave
            employee.sickLeave -= extraNeeded; // Go negative on sick leave
          }
        }
        break;

      case "restrictedHoliday":
        employee.restrictedHoliday -= leaveDays;
        break;

      case "menstrualLeave":
        employee.menstrualLeave -= leaveDays;
        break;

      case "halfDayLeave":
        employee.paidLeave -= 0.5;
        break;

      case "regularizationLeave":
        employee.regularizationLeave -= leaveDays; // Can go negative
        break;

      case "compensationLeave":
        employee.compensationLeave =
          Number(employee.compensationLeave || 0) + leaveDays;
        break;

      case "onOfficeDuty":
        employee.onOfficeDuty = Number(employee.onOfficeDuty || 0) + leaveDays;
        break;

      default:
        return res.status(400).json({ error: "Invalid leave type" });
    }

    // Save the updated employee leave balance
    await employee.save();

    // Update the leave request status
    leaveRequest.leaveStatus = leaveStatus;
    const updatedData = await leaveRequest.save();

    res.status(200).json({
      message: "Leave status updated and balance adjusted",
      updatedData,
    });
  } catch (error) {
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
