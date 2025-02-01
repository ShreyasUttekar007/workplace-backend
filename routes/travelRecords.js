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

    // Create new travel request
    const newTravelRequest = await TravelRecord.create(travelData);

    // Email notification setup
    const formatDate = (dateString) =>
      dateString ? new Date(dateString).toLocaleDateString("en-GB") : "NA";

    const msg = {
      to: [
        // "ops.maharashtra@showtimeconsulting.in",
        "stc.portal@showtimeconsulting.in",
      ],
      from: "stc.portal@showtimeconsulting.in",
      cc: travelData.email, // CC the sender
      subject: `Travel Request - ${travelData.purposeOfTravel} :: ${newTravelRequest.name} :: ${newTravelRequest.travelCode}`,
      text: `Dear Admin Team,

I hope this message finds you well. I am requesting travel/accommodation arrangements for an upcoming event.

- **Travel Date:** ${formatDate(travelData.travelDate)}
- **From:** ${travelData.fromLocation} 
- **To:** ${travelData.toLocation} 
- **Event Location:** ${travelData.eventLocation} 
- **Purpose of Travel:** ${travelData.purposeOfTravel}
- **Accommodation:** ${formatDate(
        travelData.accommodationStartDate
      )} to ${formatDate(travelData.accommodationEndDate)}
- **Remarks:** ${travelData.remarks || "N/A"}

Thank you for processing this request.

Best regards,  
${travelData.name}`,
      html: `
      <p>Dear Admin Team,</p>
      <p>I hope this message finds you well. I am requesting travel/accommodation arrangements for an upcoming event.</p>
      <ul>
        <li><strong>Travel Date:</strong> ${formatDate(
          travelData.travelDate
        )}</li>
        <li><strong>From:</strong> ${travelData.fromLocation}</li>
        <li><strong>To:</strong> ${travelData.toLocation}</li>
        <li><strong>Event Location:</strong> ${travelData.eventLocation}</li>
        <li><strong>Purpose of Travel:</strong> ${
          travelData.purposeOfTravel
        }</li>
        <li><strong>Accommodation:</strong> ${formatDate(
          travelData.accommodationStartDate
        )} to ${formatDate(travelData.accommodationEndDate)}</li>
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

router.get("/travel-requests", authenticateUser, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.userId;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }

    // Fetch travel requests for the specific user
    const leaveRequests = await TravelRecord.find({ userId }).sort({
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
