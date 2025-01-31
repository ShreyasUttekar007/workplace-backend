const express = require("express");
const router = express.Router();
require("dotenv").config();
const TravelRecord = require("../models/TravelRecord");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const sgMail = require("@sendgrid/mail");
const EmployeeLeave = require("../models/EmployeeData");

router.use(authenticateUser);

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

router.post("/travel-record", async (req, res) => {
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
  
      // Create new travel request
      const newTravel = await TravelRecord.create(momData);
  
      res.status(201).json(newTravel);
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
    const leaveRequests = await TravelRecord.find({ userId }).sort({ createdAt: -1 });

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
      leaveRequests = await TravelRecord.find({ receiverEmail: userEmail }).sort({
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
