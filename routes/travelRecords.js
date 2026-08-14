const express = require("express");
const router = express.Router();
require("dotenv").config();
const TravelRecord = require("../models/TravelRecord");
const { roles } = require("../models/User");
const User = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const sgMail = require("@sendgrid/mail");

router.use(authenticateUser);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Treat a datetime-local value (e.g. "2026-08-05T14:00", no timezone) as IST wall
// time and return the correct instant, so times don't shift by the server's zone.
const istDate = (v) => {
  if (!v) return v;
  if (v instanceof Date) return v;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    const withSec = s.length === 16 ? s + ":00" : s;
    return new Date(withSec + "+05:30");
  }
  return new Date(s);
};

router.post("/travel-record", async (req, res) => {
  try {
    const travelData = req.body;

    // Validate user authorization
    if (!req.user || !req.user._id) {
      return res.status(403).json({ error: "Unauthorized user" });
    }

    // Ensure userId matches the logged-in user's ID
    if (travelData.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    const formatDate = (dateString) =>
      dateString ? new Date(dateString).toLocaleDateString("en-GB") : "NA";

    // Normalise multi-leg input. Older clients may still send single fields;
    // wrap those into a one-element array so everything downstream is uniform.
    const legs =
      Array.isArray(travelData.travelLegs) && travelData.travelLegs.length
        ? travelData.travelLegs
        : travelData.travelDate || travelData.fromLocation || travelData.toLocation
        ? [
            {
              travelDate: travelData.travelDate,
              fromLocation: travelData.fromLocation,
              toLocation: travelData.toLocation,
            },
          ]
        : [];
    const stays =
      Array.isArray(travelData.accommodations) && travelData.accommodations.length
        ? travelData.accommodations
        : travelData.accommodationStartDate || travelData.accommodationEndDate
        ? [
            {
              startDate: travelData.accommodationStartDate,
              endDate: travelData.accommodationEndDate,
              location: "",
            },
          ]
        : [];

    // Anchor self-request datetimes to IST so times don't shift by server zone.
    const istLegs = legs.map((l) => ({
      ...l,
      travelDate: istDate(l.travelDate),
    }));
    const istStays = stays.map((a) => ({
      ...a,
      startDate: istDate(a.startDate),
      endDate: istDate(a.endDate),
    }));
    travelData.travelLegs = istLegs;
    travelData.accommodations = istStays;
    // Keep legacy single fields in sync with the first leg/stay so old readers
    // (tables, reports) still show something sensible.
    if (istLegs[0]) {
      travelData.travelDate = istLegs[0].travelDate;
      travelData.fromLocation = istLegs[0].fromLocation;
      travelData.toLocation = istLegs[0].toLocation;
    }
    if (istStays[0]) {
      travelData.accommodationStartDate = istStays[0].startDate;
      travelData.accommodationEndDate = istStays[0].endDate;
    }

    // Two-stage approval: route to the requester's reporting manager for review.
    // If they have no reporting manager, skip the reviewer stage (goes to admin).
    try {
      const requester = await User.findOne({ email: travelData.email });
      const rmEmail = (requester?.reportingManagerEmail || "").trim();
      if (rmEmail) {
        travelData.reviewerEmail = rmEmail;
        travelData.reviewerStatus = "pending";
      } else {
        travelData.reviewerStatus = "not_required";
      }
    } catch (e) {
      travelData.reviewerStatus = "not_required";
    }

    // Create new travel request
    const newTravelRequest = await TravelRecord.create(travelData);

    const legsText = legs.length
      ? legs
          .map(
            (l, i) =>
              `  ${i + 1}. ${l.fromLocation || "?"} -> ${l.toLocation || "?"} (${formatDate(l.travelDate)})`
          )
          .join("\n")
      : "  NA";
    const legsHtml = legs.length
      ? legs
          .map(
            (l, i) =>
              `<li>${i + 1}. <strong>${l.fromLocation || "?"} &rarr; ${l.toLocation || "?"}</strong> — ${formatDate(l.travelDate)}</li>`
          )
          .join("")
      : "<li>NA</li>";
    const staysText = stays.length
      ? stays
          .map(
            (a, i) =>
              `  ${i + 1}. ${formatDate(a.startDate)} to ${formatDate(a.endDate)}${a.location ? " @ " + a.location : ""}`
          )
          .join("\n")
      : "  NA";
    const staysHtml = stays.length
      ? stays
          .map(
            (a, i) =>
              `<li>${i + 1}. ${formatDate(a.startDate)} to ${formatDate(a.endDate)}${a.location ? " @ <strong>" + a.location + "</strong>" : ""}</li>`
          )
          .join("")
      : "<li>NA</li>";

    const msg = {
      to: [
        "ops.maharashtra@showtimeconsulting.in",
        "stc.portal@showtimeconsulting.in",
      ],
      from: "stc.portal@showtimeconsulting.in",
      cc: travelData.email, // CC the sender
      subject: `Travel Request - ${travelData.purposeOfTravel} :: ${newTravelRequest.name} :: ${newTravelRequest.travelCode}`,
      text: `Dear Admin Team,

I hope this message finds you well. I am requesting travel/accommodation arrangements for an upcoming event.

- **Travel Itinerary:**
${legsText}
- **Name:** ${newTravelRequest.name} 
- **Contact Number:** ${newTravelRequest.employeePhoneNumber} 
- **Age:** ${travelData.age} 
- **Event Location:** ${travelData.eventLocation} 
- **Purpose of Travel:** ${travelData.purposeOfTravel}
- **Accommodation:**
${staysText}
- **Remarks:** ${travelData.remarks || "N/A"}

Thank you for processing this request.

Best regards,  
${travelData.name}`,
      html: `
      <p>Dear Admin Team,</p>
      <p>I hope this message finds you well. I am requesting travel/accommodation arrangements for an upcoming event.</p>
      <ul>
        <li><strong>Travel Itinerary:</strong><ul>${legsHtml}</ul></li>
        <li><strong>Name:</strong> ${newTravelRequest.name}</li>
        <li><strong>Contact Number:</strong> ${newTravelRequest.employeePhoneNumber}</li>
        <li><strong>Age:</strong> ${travelData.age}</li>
        <li><strong>Event Location:</strong> ${travelData.eventLocation}</li>
        <li><strong>Purpose of Travel:</strong> ${
          travelData.purposeOfTravel
        }</li>
        <li><strong>Accommodation:</strong><ul>${staysHtml}</ul></li>
        <li><strong>Remarks:</strong> ${travelData.remarks || "N/A"}</li>
      </ul>
      <p>Thank you for processing this request.</p>
      <p>Best regards,<br />${newTravelRequest.name}</p>
      `,
    };

    // Send email
    try {
      await sgMail.send(msg);
      console.log("Email sent successfully!");
    } catch (error) {
      console.error("Error sending email:", error);
    }

    res.status(201).json(newTravelRequest);
  } catch (error) {
    console.error("Error processing travel request:", error);
    res.status(500).json({ error: error.message });
  }
});

// ---- GROUP travel: a reporting manager raises ONE request for several team
// members over a connecting, multi-leg itinerary. Each leg carries its own
// destination accommodation. We create one record PER member (each holding the
// full leg list) so the status/admin tables expand to one row per member x leg.
router.post("/group-travel-record", async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(403).json({ error: "Unauthorized user" });
    }

    const {
      itineraries, // [{ members:[{userId,email}], travelLegs:[...], eventDetails }]
      members, // legacy single-block shape
      travelLegs, // legacy single-block shape
      eventDetails, // legacy single-block shape
      requestType,
      purposeOfTravel,
      eventName,
      eventLocation,
      remarks,
      travelInstructedBy,
    } = req.body;

    // Normalise to a list of blocks. New clients send `itineraries`; older ones
    // send a single members/travelLegs/eventDetails set.
    const blocks =
      Array.isArray(itineraries) && itineraries.length
        ? itineraries
        : [{ members, travelLegs, eventDetails }];

    // Basic validation across all blocks.
    for (const b of blocks) {
      if (!b || !Array.isArray(b.members) || b.members.length === 0) {
        return res
          .status(400)
          .json({ error: "Each itinerary needs at least one team member." });
      }
      const bl = Array.isArray(b.travelLegs) ? b.travelLegs.filter(Boolean) : [];
      if (bl.length === 0) {
        return res.status(400).json({ error: "Each itinerary needs at least one leg." });
      }
    }

    const fmt = (d) => (d ? new Date(d).toLocaleString("en-GB") : "NA");
    const requestedByEmail = (req.user.email || "").toLowerCase();
    const requestedByName =
      req.user.name || req.user.userName || req.user.email || "Reporting Manager";
    const groupId = `TRG-${Date.now().toString(36).toUpperCase()}`;

    // Who reviews this group request? If the raiser is the MANAGER of the people
    // being booked (they report to the raiser), it's manager-raised -> skip review
    // and go straight to admin. Otherwise (a team member booking teammates) it goes
    // to the raiser's reporting manager for approval, then admin.
    const raiserRec = await User.findOne({
      email: { $regex: new RegExp(`^${requestedByEmail}$`, "i") },
    });
    const raiserRM = (raiserRec?.reportingManagerEmail || "").trim();

    const created = [];
    const failed = [];
    const emailBlocks = [];

    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const legs = (Array.isArray(block.travelLegs) ? block.travelLegs : [])
        .filter(Boolean)
        .map((l) => ({
          ...l,
          travelDate: istDate(l.travelDate),
          accommodationStartDate: istDate(l.accommodationStartDate),
          accommodationEndDate: istDate(l.accommodationEndDate),
        }));
      const blockEventDetails = block.eventDetails || "";

      // Decide the reviewer for THIS block.
      const blockEmails = (block.members || []).map((m) => m.email).filter(Boolean);
      const memberRecs = blockEmails.length
        ? await User.find({ email: { $in: blockEmails } })
        : [];
      const raiserIsTheirManager =
        memberRecs.length > 0 &&
        memberRecs.every(
          (mr) => (mr.reportingManagerEmail || "").toLowerCase() === requestedByEmail
        );
      let reviewerFields;
      if (raiserIsTheirManager) {
        // Manager booked their own reports -> reviewer stage already satisfied.
        reviewerFields = {
          reviewerStatus: "approved",
          reviewerEmail: requestedByEmail,
          reviewedByEmail: requestedByEmail,
          reviewedByName: requestedByName,
          reviewedAt: new Date(),
        };
      } else if (raiserRM) {
        // Team member booked teammates -> route to the raiser's reporting manager.
        reviewerFields = {
          reviewerStatus: "pending",
          reviewerEmail: raiserRM,
        };
      } else {
        // No reporting manager above the raiser -> straight to admin.
        reviewerFields = { reviewerStatus: "not_required" };
      }

      for (const m of block.members) {
        if (!m || !m.email || !m.userId) {
          failed.push({ email: m && m.email, reason: "Missing email or userId" });
          continue;
        }
        try {
          const recordData = {
            userId: m.userId,
            email: m.email,
            requestType,
            travelLegs: legs,
            purposeOfTravel,
            eventName,
            eventLocation,
            eventDetails: blockEventDetails,
            remarks,
            travelInstructedBy,
            isGroupRequest: true,
            groupId,
            requestedByEmail,
            requestedByName,
            ...reviewerFields,
          };
          if (legs[0]) {
            recordData.travelDate = legs[0].travelDate;
            recordData.fromLocation = legs[0].fromLocation;
            recordData.toLocation = legs[0].toLocation;
            recordData.accommodationStartDate = legs[0].accommodationStartDate;
            recordData.accommodationEndDate = legs[0].accommodationEndDate;
          }
          const rec = await TravelRecord.create(recordData);
          created.push({ email: m.email, name: rec.name, travelCode: rec.travelCode });
        } catch (err) {
          failed.push({ email: m.email, reason: err.message });
        }
      }

      const legLines = legs
        .map((l, i) => {
          const travel =
            l.fromLocation || l.toLocation
              ? `${l.fromLocation || "?"} -> ${l.toLocation || "?"} (${fmt(l.travelDate)})`
              : "";
          const stay = l.accommodationPlace
            ? `stay: ${l.accommodationPlace} ${fmt(l.accommodationStartDate)} to ${fmt(l.accommodationEndDate)}`
            : "";
          return `    ${i + 1}. ${[travel, stay].filter(Boolean).join(" | ")}`;
        })
        .join("\n");
      const people = (block.members || []).map((mm) => mm.email).join(", ");
      emailBlocks.push(
        `Itinerary ${bi + 1}\n  Members: ${people}\n  Legs:\n${legLines}${blockEventDetails ? "\n  Event Details: " + blockEventDetails : ""}`
      );
    }

    try {
      await sgMail.send({
        to: process.env.MAIL_FROM || "stc.portal@showtimeconsulting.in",
        from: process.env.MAIL_FROM || "stc.portal@showtimeconsulting.in",
        subject: `Group Travel (${created.length} records, ${blocks.length} itinerary/ies) — ${requestType} — by ${requestedByName}`,
        text: `Group travel raised by ${requestedByName}.\n\nRequest Type: ${requestType}\nPurpose: ${purposeOfTravel || "NA"}\nEvent: ${eventName || "NA"}\nRemarks: ${remarks || "N/A"}\n\n${emailBlocks.join("\n\n")}`,
      });
    } catch (mailErr) {
      console.error("Group travel email failed:", mailErr.message);
    }

    return res.status(201).json({ groupId, created, failed });
  } catch (error) {
    console.error("Error processing group travel request:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/travel-requests", authenticateUser, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.userId;
    const myEmail = (req.user?.email || "").toLowerCase();

    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }

    // Own travel + any group requests the manager raised for their team.
    const leaveRequests = await TravelRecord.find({
      $or: [{ userId }, { requestedByEmail: myEmail }],
    }).sort({
      createdAt: -1,
    });

    res.status(200).json({ leaveRequests });
  } catch (error) {
    console.error("Error fetching travel requests:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/travel-requests-emails", authenticateUser, async (req, res) => {
  try {
    const userRoles = req.user?.roles || []; // Extract roles from the authenticated user
    const userEmail = req.user?.email; // Extract the authenticated user's email
    console.log("User Roles: ", userRoles);
    console.log("User Email: ", userEmail);

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required." });
    }

    // Emails granted full Admin Travel Data access (see all travel records),
    // in addition to anyone with the "admin" role.
    const TRAVEL_ADMIN_EMAILS = [
      "rajkumar@showtimeconsulting.in",
      "prathik.kethavath@showtimeconsulting.in",
      "nikash.kumar@showtimeconsulting.in",
    ];
    const isTravelAdmin =
      userRoles.includes("admin") ||
      TRAVEL_ADMIN_EMAILS.includes((userEmail || "").toLowerCase());

    let leaveRequests;

    // Check if the user is an admin (role) or an allow-listed travel admin
    if (isTravelAdmin) {
      // Admin only sees requests that cleared the reviewer stage (approved by the
      // reporting manager, or no reviewer was required). Records created BEFORE
      // this feature have no reviewerStatus at all — keep showing those so nothing
      // historical disappears from admin.
      leaveRequests = await TravelRecord.find({
        $or: [
          { reviewerStatus: { $in: ["approved", "not_required"] } },
          { reviewerStatus: { $exists: false } },
          { reviewerStatus: null },
          { reviewerStatus: "" },
        ],
      }).sort({ createdAt: -1 });
    } else {
      // Fetch travel requests where the user's email is mentioned in receiverEmail
      leaveRequests = await TravelRecord.find({
        receiverEmail: userEmail,
      }).sort({
        createdAt: -1,
      });
    }

    res.status(200).json({ leaveRequests });
  } catch (error) {
    console.error("Error fetching travel requests by email:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/get-travel", async (req, res) => {
  try {
    const moms = await TravelRecord.find().populate("userId");
    res.status(200).json(moms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-travel-by-id/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    console.log("momId::: ", momId);
    const mom = await TravelRecord.findById(momId).populate("userId");

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
    const updatedMom = await TravelRecord.findByIdAndUpdate(momId, req.body, {
      new: true,
    });
    res.status(200).json(updatedMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-travel-status/:id", async (req, res) => {
  const { id } = req.params;
  const { requestStatus } = req.body;

  try {
    // Fetch the travel request by ID
    const leaveRequest = await TravelRecord.findById(id);

    if (!leaveRequest) {
      return res.status(404).json({ error: "TravelRecord request not found" });
    }

    // Update the request status
    leaveRequest.requestStatus = requestStatus;
    const updatedData = await leaveRequest.save();

    return res.status(200).json(updatedData);
  } catch (error) {
    console.error("Error updating travel status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/delete-mom/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const rec = await TravelRecord.findById(momId);
    if (!rec) {
      return res.status(404).json({ error: "Travel record not found" });
    }

    // Only the person who RAISED the request (group), the traveller who owns the
    // record (self), or an admin may delete it.
    const myEmail = (req.user?.email || "").toLowerCase();
    const myId = String(req.user?._id || req.user?.userId || "");
    const isRaiser =
      !!myEmail && (rec.requestedByEmail || "").toLowerCase() === myEmail;
    const isOwner = !!myId && String(rec.userId || "") === myId;
    const isAdmin = (req.user?.roles || []).includes("admin");
    if (!isRaiser && !isOwner && !isAdmin) {
      return res
        .status(403)
        .json({ error: "You can only delete requests you raised." });
    }

    await TravelRecord.findByIdAndDelete(momId);
    res.status(200).json({ message: "Travel record deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Reviewer (reporting manager) approval stage ----

// Requests awaiting MY review (I am the assigned reviewer / reporting manager).
router.get("/reviewer-queue", authenticateUser, async (req, res) => {
  try {
    const myEmail = (req.user?.email || "").toLowerCase();
    if (!myEmail) return res.status(400).json({ error: "User email required." });
    const records = await TravelRecord.find({
      reviewerStatus: "pending",
      reviewerEmail: { $regex: new RegExp(`^${myEmail}$`, "i") },
    }).sort({ createdAt: -1 });
    res.status(200).json({ records });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reviewer approves or rejects a request. Approve -> goes to admin. Reject -> stops.
router.put("/reviewer-decision/:id", authenticateUser, async (req, res) => {
  try {
    const { decision } = req.body; // "approved" | "rejected"
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "Invalid decision." });
    }
    const rec = await TravelRecord.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Request not found." });

    const myEmail = (req.user?.email || "").toLowerCase();
    const isReviewer = !!myEmail && (rec.reviewerEmail || "").toLowerCase() === myEmail;
    const isAdmin = (req.user?.roles || []).includes("admin");
    if (!isReviewer && !isAdmin) {
      return res
        .status(403)
        .json({ error: "Only the assigned reviewer can act on this request." });
    }
    if (rec.reviewerStatus !== "pending") {
      return res
        .status(409)
        .json({ error: `This request was already ${rec.reviewerStatus}.` });
    }

    // Persist via findByIdAndUpdate so the model's pre-save hook (which re-validates
    // employee data and can throw) does NOT block a simple status change.
    await TravelRecord.findByIdAndUpdate(
      req.params.id,
      {
        reviewerStatus: decision,
        reviewedByEmail: req.user.email,
        reviewedByName:
          req.user.name || req.user.userName || req.user.email || "Reviewer",
        reviewedAt: new Date(),
      },
      { new: true }
    );
    res.status(200).json({ message: `Request ${decision}.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
