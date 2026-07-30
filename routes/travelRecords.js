const express = require("express");
const router = express.Router();
require("dotenv").config();
const TravelRecord = require("../models/TravelRecord");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const sgMail = require("@sendgrid/mail");

router.use(authenticateUser);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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

    travelData.travelLegs = legs;
    travelData.accommodations = stays;
    // Keep legacy single fields in sync with the first leg/stay so old readers
    // (tables, reports) still show something sensible.
    if (legs[0]) {
      travelData.travelDate = legs[0].travelDate;
      travelData.fromLocation = legs[0].fromLocation;
      travelData.toLocation = legs[0].toLocation;
    }
    if (stays[0]) {
      travelData.accommodationStartDate = stays[0].startDate;
      travelData.accommodationEndDate = stays[0].endDate;
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

    const created = [];
    const failed = [];
    const emailBlocks = [];

    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const legs = (Array.isArray(block.travelLegs) ? block.travelLegs : []).filter(Boolean);
      const blockEventDetails = block.eventDetails || "";

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

    let leaveRequests;

    // Check if the user is an admin
    if (userRoles.includes("admin")) {
      // Fetch all travel requests if the user has the admin role
      leaveRequests = await TravelRecord.find().sort({ createdAt: -1 });
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
    const deletedMom = await TravelRecord.findByIdAndDelete(momId);
    if (!deletedMom) {
      return res.status(404).json({ error: "Travel record not found" });
    }
    res.status(200).json({ message: "Travel record deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
