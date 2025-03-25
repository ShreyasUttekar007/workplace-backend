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
const EmployeeLeave = require("../models/EmployeeData");

router.use(authenticateUser);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

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

    const requestDate = new Date(cabData.dateOfRequest);
    requestDate.setHours(0, 0, 0, 0);
    
    // Fetch existing requests for the same date
    const existingRequest = await CabRecord.findOne({
      userId: cabData.userId,
      dateOfRequest: cabData.dateOfRequest,
    });    

    if (existingRequest) {
      return res.status(400).json({ error: "Cab request already exists for this date for either you or one of your add-on persons." });
    }

    // Create new cab request
    const newCabRequest = await CabRecord.create(cabData);
    res.status(201).json(newCabRequest);
  } catch (error) {
    console.error("❌ Error processing cab request:", error);
    res.status(500).json({ error: error.message });
  }
});



router.get("/employees/soul-field", async (req, res) => {
  try {
    const employees = await EmployeeLeave.find(
      { department: "Soul Field" },
      { employeeEmail: 1, employeeName: 1, employeePhoneNumber: 1, _id: 0 }
    );

    res.status(200).json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/cab-requests", authenticateUser, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.userId;
    const userEmail = req.user?.email;

    if (!userId && !userEmail) {
      return res.status(400).json({ error: "User ID or email is required." });
    }

    // Fetch cab requests where:
    // - The user is the requestor (userId matches)
    // - OR the user's email is in addOnPerson.employeeEmail
    const cabRequests = await CabRecord.find({
      $or: [
        { userId },
        {
          "addOnPerson.employeeEmail": {
            $regex: new RegExp(`^${userEmail}$`, "i"),
          },
        }, // Case-insensitive match
      ],
    }).sort({ createdAt: -1 });

    res.status(200).json({ cabRequests });
  } catch (error) {
    console.error("❌ Error fetching cab requests:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get(
  "/cab-requests-reporting-manager",
  authenticateUser,
  async (req, res) => {
    try {
      const userEmail = req.user?.email;
      console.log("✌️userEmail --->", userEmail);

      if (!userEmail) {
        return res.status(400).json({ error: "User email is required." });
      }
      // Fetch cab requests where the user's email is mentioned in reportingManagerEmail
      const cabRequests = await CabRecord.find({
        recieverEmail: userEmail,
      }).sort({ createdAt: -1 });

      res.status(200).json({ cabRequests });
    } catch (error) {
      console.error(
        "Error fetching cab requests by reporting manager email:",
        error
      );
      res.status(500).json({ error: "Internal server error." });
    }
  }
);

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

router.put("/update-user-cab-data/:momId", async (req, res) => {
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

router.put("/update-reporting-manager-cab-data/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { cabStatus } = req.body;

    // Fetch the existing record before updating
    const existingCabRequest = await CabRecord.findById(id);
    if (!existingCabRequest) {
      return res.status(404).json({ error: "Cab request not found" });
    }

    // Update the request
    const updatedCabRequest = await CabRecord.findByIdAndUpdate(id, req.body, {
      new: true,
    });
    const formatTo12Hour = (time) => {
      const [hours, minutes] = time.split(":");
      const date = new Date();
      date.setHours(parseInt(hours), parseInt(minutes));
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    };

    const recipientNumber = `whatsapp:+919082210297`;
    // If status changed from "pending" to "approved", send WhatsApp message
    if (
      existingCabRequest.cabStatus === "pending" &&
      cabStatus === "approved"
    ) {
      const addOnDetails =
        updatedCabRequest.addOnPerson &&
        updatedCabRequest.addOnPerson.length > 0
          ? updatedCabRequest.addOnPerson
              .map(
                (person) =>
                  `${person.employeeName} - ${person.employeePhoneNumber}`
              )
              .join("\n")
          : "None";

const messageBody = `🚖 *Cab Request* 
*Name:* ${updatedCabRequest.name}
*Mobile Number:* ${updatedCabRequest.employeePhoneNumber}
*Date:* ${new Date(updatedCabRequest.dateOfRequest).toLocaleDateString("en-GB")}
*Pickup Location:* ${updatedCabRequest.pickupLocation}
*Pickup Time:* ${formatTo12Hour(updatedCabRequest.pickupTime)}

*Co-Passengers:* 
${addOnDetails}`;

      // Send WhatsApp message
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER, // Directly using env variable
        to: recipientNumber,
        body: messageBody,
      });

      console.log("✅ WhatsApp message sent successfully!");
    }

    res.status(200).json(updatedCabRequest);
  } catch (error) {
    console.error("Error updating cab request:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-cab-data/:momId", async (req, res) => {
  try {
    const { momId } = req.params;

    // Update the record
    await CabRecord.findByIdAndUpdate(momId, req.body, { new: true });

    // Fetch the updated record again to ensure all fields are populated
    const updatedMom = await CabRecord.findById(momId);

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
        formattedPhone.length === 10
          ? `+91${formattedPhone}`
          : `+${formattedPhone}`;

      // Ensure all required fields are present before sending the message
      if (cabNumber && driverName && driverNumber) {
        const message = `Dear ${name},\n\nPlease find your cab details below:\n🚖 Pickup Location: ${pickupLocation}\n⏰ Pickup Time: ${pickupTime}\n🚕 Cab Number: ${cabNumber}\n👨‍✈️ Driver Name: ${driverName}\n📞 Driver Number: ${driverNumber}\n\nThank you.`;

        // Send WhatsApp message
        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: `whatsapp:${phoneNumber}`,
          body: message,
        });

        console.log("WhatsApp notification sent successfully!");
      } else {
        console.log("Cab details incomplete. WhatsApp message not sent.");
      }
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
