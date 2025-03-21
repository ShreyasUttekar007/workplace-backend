const express = require("express");
const router = express.Router();
require("dotenv").config();
const CabRecord = require("../models/CabRequests");
const VendorList = require("../models/VendorList");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const sgMail = require("@sendgrid/mail");
const { Parser } = require("json2csv");
const twilio = require("twilio");

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

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

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

    // Retrieve the saved request (to get employeePhoneNumber)
    const savedCabRequest = await CabRecord.findById(newCabRequest._id);

    if (!savedCabRequest || !savedCabRequest.employeePhoneNumber) {
      return res.status(500).json({ error: "Failed to retrieve phone number." });
    }

    const recipientNumber = `whatsapp:+919082210297`;
    console.log("📨 Sending WhatsApp message to:", recipientNumber);

    // Convert to 12-hour format
    const formatTo12Hour = (time) => {
      const [hours, minutes] = time.split(":");
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes));
      return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    };

    // Format WhatsApp message
    const messageBody = `🚖 Cab Request
Name: ${savedCabRequest.name}
Phone: ${savedCabRequest.employeePhoneNumber}
Date: ${new Date(savedCabRequest.dateOfRequest).toLocaleDateString("en-GB")}
Pickup Location: ${savedCabRequest.pickupLocation}
Pickup Time: ${formatTo12Hour(savedCabRequest.pickupTime)}`;

    // Send WhatsApp message
    try {
      const message = await client.messages.create({
        body: messageBody,
        from: process.env.TWILIO_WHATSAPP_NUMBER, // Directly using env variable
        to: recipientNumber,
      });
      console.log("✅ WhatsApp Message Sent:", message.sid);
    } catch (twilioError) {
      console.error("❌ Twilio WhatsApp Error:", twilioError.message);
    }

    res.status(201).json(savedCabRequest);
  } catch (error) {
    console.error("❌ Error processing cab request:", error);
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

    if (!updatedMom) {
      return res.status(404).json({ error: "Cab record not found" });
    }

    // Extract updated details
    const {
      name,
      employeePhoneNumber,
      pickupLocation,
      pickupTime,
      cabNumber,
      driverName,
      driverNumber,
    } = updatedMom;

    if (employeePhoneNumber) {
      const formattedPhone = employeePhoneNumber.replace(/\D/g, ""); // Extract digits
      const phoneNumber =
        formattedPhone.length === 10 ? `+91${formattedPhone}` : `+${formattedPhone}`;

      // WhatsApp message
      const message = `Dear ${name},\n\nPlease find your updated cab details below:\n🚖 Pickup Location: ${pickupLocation}\n⏰ Pickup Time: ${pickupTime}\n🚕 Cab Number: ${cabNumber}\n👨‍✈️ Driver Name: ${driverName}\n📞 Driver Number: ${driverNumber}\n\nThank you.`;

      // Send WhatsApp message
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${phoneNumber}`,
        body: message,
      });

      console.log("WhatsApp notification sent successfully!");
    }

    res.status(200).json(updatedMom);
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/export-csv", async (req, res) => {
  try {
    // Fetch all form data from the database
    const formData = await CabRecord.find({});

    // Define the fields you want in the CSV
    const fields = [
      "userId",
      "cabRequestCode",
      "name",
      "employeeCode",
      "email",
      "dateOfRequest",
      "employeePhoneNumber",
      "pickupTime",
      "pickupLocation",
      "purpose",
      "recieverEmail",
      "recieverName",
      "startTime",
      "speedometerStartPhoto",
      "startingDistance",
      "endTime",
      "speedometerEndPhoto",
      "endKm",
      "cabNumber",
      "driverName",
      "driverNumber",
      "remarks",
      "vendor",
    ];

    // Create a JSON2CSV parser instance
    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(formData);

    // Set the proper headers for a CSV download
    res.header("Content-Type", "text/csv");
    res.attachment("formData.csv");
    res.send(csv);
  } catch (err) {
    console.error("Error exporting data to CSV:", err);
    res.status(500).json({ error: "Failed to export data to CSV" });
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
