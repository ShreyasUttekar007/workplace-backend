const express = require("express");
const router = express.Router();
require("dotenv").config();
const CabRecord = require("../models/CabRequests");
const VendorList = require("../models/VendorList");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const sgMail = require("@sendgrid/mail");

router.use(authenticateUser);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// router.post("/cab-record", async (req, res) => {
//   try {
//     const cabData = req.body;

//     // Validate user authorization
//     if (!req.user || !req.user._id) {
//       return res.status(403).json({ error: "Unauthorized user" });
//     }

//     // Ensure userId matches the logged-in user's ID
//     if (cabData.userId.toString() !== req.user._id.toString()) {
//       return res.status(403).json({ error: "Forbidden - Unauthorized user" });
//     }

//     // Create new cab request
//     const newCabRequest = await CabRecord.create(cabData);

//     // Email notification setup
//     const formatDate = (dateString) =>
//       dateString ? new Date(dateString).toLocaleDateString("en-GB") : "NA";

//     const msg = {
//       to: [
//         "ops.maharashtra@showtimeconsulting.in",
//         "stc.portal@showtimeconsulting.in",
//       ],
//       from: "stc.portal@showtimeconsulting.in",
//       cc: cabData.email, // CC the sender
//       subject: `Cab Request - ${cabData.purposeOfCab} :: ${newCabRequest.name} :: ${newCabRequest.cabCode}`,
//       text: `Dear Admin Team,

// I hope this message finds you well. I am requesting cab/accommodation arrangements for an upcoming event.

// - **Cab Date:** ${formatDate(cabData.cabDate)}
// - **From:** ${cabData.fromLocation}
// - **To:** ${cabData.toLocation}
// - **Event Location:** ${cabData.eventLocation}
// - **Purpose of cab:** ${cabData.purposeOfCab}
// - **Accommodation:** ${formatDate(
//         cabData.accommodationStartDate
//       )} to ${formatDate(cabData.accommodationEndDate)}
// - **Remarks:** ${cabData.remarks || "N/A"}

// Thank you for processing this request.

// Best regards,
// ${cabData.name}`,
//       html: `
//       <p>Dear Admin Team,</p>
//       <p>I hope this message finds you well. I am requesting cab/accommodation arrangements for an upcoming event.</p>
//       <ul>
//         <li><strong>Cab Date:</strong> ${formatDate(
//           cabData.cabDate
//         )}</li>
//         <li><strong>From:</strong> ${cabData.fromLocation}</li>
//         <li><strong>To:</strong> ${cabData.toLocation}</li>
//         <li><strong>Event Location:</strong> ${cabData.eventLocation}</li>
//         <li><strong>Purpose of Cab:</strong> ${
//           cabData.purposeOfCab
//         }</li>
//         <li><strong>Accommodation:</strong> ${formatDate(
//           cabData.accommodationStartDate
//         )} to ${formatDate(cabData.accommodationEndDate)}</li>
//         <li><strong>Remarks:</strong> ${cabData.remarks || "N/A"}</li>
//       </ul>
//       <p>Thank you for processing this request.</p>
//       <p>Best regards,<br />${newCabRequest.name}</p>
//       `,
//     };

//     // Send email
//     try {
//       await sgMail.send(msg);
//       console.log("Email sent successfully!");
//     } catch (error) {
//       console.error("Error sending email:", error);
//     }

//     res.status(201).json(newCabRequest);
//   } catch (error) {
//     console.error("Error processing cab request:", error);
//     res.status(500).json({ error: error.message });
//   }
// });

router.post("/cab-record", async (req, res) => {
  try {
    const cabData = req.body;

    // Validate user authorization
    if (!req.user || !req.user._id) {
      return res.status(403).json({ error: "Unauthorized user" });
    }

    // Ensure userId matches the logged-in user's ID
    if (cabData.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    // Create new cab request
    const newCabRequest = await CabRecord.create(cabData);

    res.status(201).json(newCabRequest);
  } catch (error) {
    console.error("Error processing cab request:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/cab-requests", authenticateUser, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.userId;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required." });
    }

    // Fetch cab requests for the specific user
    const cabRequests = await CabRecord.find({ userId }).sort({
      createdAt: -1,
    });

    res.status(200).json({ cabRequests });
  } catch (error) {
    console.error("Error fetching cab requests:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/cab-requests-emails", authenticateUser, async (req, res) => {
  try {
    const userRoles = req.user?.roles || []; // Extract roles from the authenticated user
    const userEmail = req.user?.email; // Extract the authenticated user's email
    console.log("User Roles: ", userRoles);
    console.log("User Email: ", userEmail);

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required." });
    }

    let cabRequests;

    // Check if the user is an admin
    if (userRoles.includes("admin")) {
      // Fetch all cab requests if the user has the admin role
      cabRequests = await CabRecord.find().sort({ createdAt: -1 });
    } else {
      // Fetch cab requests where the user's email is mentioned in receiverEmail
      cabRequests = await CabRecord.find({
        receiverEmail: userEmail,
      }).sort({
        createdAt: -1,
      });
    }

    res.status(200).json({ cabRequests });
  } catch (error) {
    console.error("Error fetching cab requests by email:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/get-cab", async (req, res) => {
  try {
    const moms = await CabRecord.find().populate("userId");
    res.status(200).json(moms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/vendors", async (req, res) => {
  try {
    const vendors = await VendorList.find();
    res.status(200).json(vendors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-cab-by-id/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    console.log("momId::: ", momId);
    const mom = await CabRecord.findById(momId).populate("userId");

    if (!mom) {
      return res.status(404).json({ error: "MOM not found" });
    }

    res.status(200).json(mom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-cab-data/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const updatedMom = await CabRecord.findByIdAndUpdate(momId, req.body, {
      new: true,
    });
    res.status(200).json(updatedMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-cab-status/:id", async (req, res) => {
  const { id } = req.params;
  const { requestStatus } = req.body;

  try {
    // Fetch the cab request by ID
    const cabRequests = await CabRecord.findById(id);

    if (!cabRequests) {
      return res.status(404).json({ error: "CabRecord request not found" });
    }

    // Update the request status
    cabRequests.requestStatus = requestStatus;
    const updatedData = await cabRequests.save();

    return res.status(200).json(updatedData);
  } catch (error) {
    console.error("Error updating cab status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/delete-cab-request/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const deletedMom = await CabRecord.findByIdAndDelete(momId);
    if (!deletedMom) {
      return res.status(404).json({ error: "Cab record not found" });
    }
    res.status(200).json({ message: "Cab record deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
