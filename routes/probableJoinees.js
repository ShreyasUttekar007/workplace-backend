const express = require("express");
const router = express.Router();
const ProbableJoinee = require("../models/ProbableJoinees");
const User = require("../models/User");
const {
  zoneRoles,
  districtRoles,
  assemblyConstituencies,
  parliamentaryConstituencyRoles,
} = require("../models/roles");
const authenticateUser = require("../middleware/authenticateUser");

router.use(authenticateUser);

router.post("/joinee", async (req, res) => {
  try {
    const momData = req.body;

    if (!momData.userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized - User not found" });
    }

    if (momData.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    const newMom = await ProbableJoinee.create(momData);
    res.status(201).json(newMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-probable-joinees/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userRoles = req.user?.roles || [];

    // Check if user is admin
    if (userRoles.includes("admin")) {
      const moms = await ProbableJoinee.find().populate("userId");
      return res.status(200).json(moms);
    }

    // Check if the requested userId matches the authenticated user's id
    if (userId !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    // Fetch user info
    const user = await User.findById(req.user._id).select("roles");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Filter roles for each category
    const userZoneRoles = userRoles.filter((role) => zoneRoles.includes(role));
    const userDistrictRoles = userRoles.filter((role) => districtRoles.includes(role));
    const userConstituencyRoles = userRoles.filter((role) => assemblyConstituencies.includes(role));
    const userParliamentaryConstituencyRoles = userRoles.filter((role) =>
      parliamentaryConstituencyRoles.includes(role)
    );

    // Construct the query dynamically
    const query = {};
    if (userZoneRoles.length > 0) query.zone = { $in: userZoneRoles };
    if (userDistrictRoles.length > 0) query.district = { $in: userDistrictRoles };
    if (userConstituencyRoles.length > 0) query.constituency = { $in: userConstituencyRoles };
    if (userParliamentaryConstituencyRoles.length > 0) {
      query.pc = { $in: userParliamentaryConstituencyRoles };
    }

    // If no roles match, only fetch MOMs for the specific user
    if (Object.keys(query).length === 0) {
      query.userId = userId;
    }
    // Fetch data from DB
    const moms = await ProbableJoinee.find(query).populate("userId");
    return res.status(200).json(moms);
  } catch (error) {
    console.error("Error fetching MOM data: ", error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
  