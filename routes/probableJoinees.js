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
const mongoose = require("mongoose");
const multer = require("multer");
const upload = multer();

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

router.get("/joinee-summary", async (req, res) => {
  try {
    const joinees = await ProbableJoinee.find({});

    const summary = {
      zone: {},
      pc: {},
      constituency: {},
    };

    const getAreaCounts = (areaOfInfluence = "") => {
      const lower = areaOfInfluence.toLowerCase();
      return {
        ward: lower.includes("ward") ? 1 : 0,
        booth: lower.includes("booth") ? 1 : 0,
        ac: lower.includes("assembly constituency") ? 1 : 0,
        pc: lower.includes("parliamentary constituency") ? 1 : 0,
      };
    };

    const getStatusCounts = (joinee) => {
      return {
        discussionNotInitiated:
          joinee.discussionWithJoinee === "Discussion Not Initiated" ? 1 : 0,
        discussionInitiated:
          joinee.discussionWithJoinee === "Discussion Initiated" ? 1 : 0,
        leaderJoined: joinee.discussionWithJoinee === "Leader Joined" ? 1 : 0,
      };
    };

    const updateSummary = (container, key, counts) => {
      if (!key) return;
      if (!container[key]) {
        container[key] = {
          total: 0,
          ward: 0,
          booth: 0,
          ac: 0,
          pc: 0,
          discussionNotInitiated: 0,
          discussionInitiated: 0,
          leaderJoined: 0,
        };
      }
      for (const k in counts) {
        container[key][k] += counts[k];
      }
    };

    for (const joinee of joinees) {
      const areaCounts = getAreaCounts(joinee.areaOfInfluence);
      const statusCounts = getStatusCounts(joinee);

      const baseCounts = {
        total: 1,
        ward: areaCounts.ward,
        booth: areaCounts.booth,
        ac: areaCounts.ac,
        pc: areaCounts.pc,
        discussionNotInitiated: statusCounts.discussionNotInitiated,
        discussionInitiated: statusCounts.discussionInitiated,
        leaderJoined: statusCounts.leaderJoined,
      };

      updateSummary(summary.zone, joinee.zone, baseCounts);
      updateSummary(summary.pc, joinee.pc, baseCounts);
      updateSummary(summary.constituency, joinee.constituency, baseCounts);

      // Store parent PC name in the AC record
      if (joinee.constituency && joinee.pc) {
        summary.constituency[joinee.constituency].pcName = joinee.pc;
      }
    }

    res.json(summary);
  } catch (error) {
    console.error("Error in /joinee-summary:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-probable-joinees/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userRoles = req.user?.roles || [];
    const userLocation = req.user?.location;

    // Construct the query dynamically
    const query = {};

    // Ensure state-based filtering for all users, including admin
    if (userLocation === "Maharashtra" || userLocation === "Andhra Pradesh") {
      query.state = userLocation;
    }

    // Fetch user info
    const user = await User.findById(req.user._id).select("roles location");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Filter roles for each category
    const userZoneRoles = userRoles.filter((role) => zoneRoles.includes(role));
    const userDistrictRoles = userRoles.filter((role) =>
      districtRoles.includes(role)
    );
    const userConstituencyRoles = userRoles.filter((role) =>
      assemblyConstituencies.includes(role)
    );
    const userParliamentaryConstituencyRoles = userRoles.filter((role) =>
      parliamentaryConstituencyRoles.includes(role)
    );

    if (userZoneRoles.length > 0) query.zone = { $in: userZoneRoles };
    if (userDistrictRoles.length > 0)
      query.district = { $in: userDistrictRoles };
    if (userConstituencyRoles.length > 0)
      query.constituency = { $in: userConstituencyRoles };
    if (userParliamentaryConstituencyRoles.length > 0) {
      query.pc = { $in: userParliamentaryConstituencyRoles };
    }

    // Admins should see all reports in their state, not just their userId
    if (!userRoles.includes("admin") && userId !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    if (!userRoles.includes("admin") && Object.keys(query).length === 1) {
      // Only state exists
      query.userId = userId;
    }
    console.log("Constructed Query: ", query);

    // Fetch data from DB
    const reports = await ProbableJoinee.find(query)
      .populate("userId")
      .sort({ createdAt: -1 });
    return res.status(200).json(reports);
  } catch (error) {
    console.error("Error fetching report data: ", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get-joinee-by-id/:joineeId", async (req, res) => {
  try {
    const { joineeId } = req.params;
    const joinee = await ProbableJoinee.findById(joineeId).populate("userId");

    if (!joinee) {
      return res.status(404).json({ error: "MOM not found" });
    }

    res.status(200).json(joinee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-joinee/:id", upload.none(), async (req, res) => {
  try {
    const { id } = req.params;
    const momData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid Joinee ID" });
    }

    const updatedJoinee = await ProbableJoinee.findByIdAndUpdate(id, momData, {
      new: true,
    });

    if (!updatedJoinee) {
      return res.status(404).json({ error: "Joinee not found" });
    }

    res.status(200).json(updatedJoinee);
  } catch (error) {
    console.error("Error updating joinee:", error);
    res.status(500).json({ error: error.message });
  }
});

// router.put("/update-joinee/:id", async (req, res) => {
//   console.log("Request received to update joinee with ID:", req.params.id); // Debug log
//   try {
//     const { id } = req.params;
//     const updatedJoinee = await ProbableJoinee.findByIdAndUpdate(id, req.body, {
//       new: true,
//     });
//     res.status(200).json(updatedJoinee);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });

module.exports = router;
