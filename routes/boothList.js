const express = require("express");
const router = express.Router();
const Report = require("../models/BoothList");
const { roles } = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const User = require("../models/User");
const { zoneRoles, districtRoles, assemblyConstituencies, parliamentaryConstituencyRoles } = require('../models/roles');

router.use(authenticateUser);

router.post("/report", async (req, res) => {
  try {
    const momData = req.body;
    if (momData.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }
    const newMom = await Report.create(momData);
    res.status(201).json(newMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report", async (req, res) => {
  try {
    const moms = await Report.find().populate("userId");
    res.status(200).json(moms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report-by-id/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const mom = await Report.findById(momId).populate("userId");

    if (!mom) {
      return res.status(404).json({ error: "MOM not found" });
    }

    res.status(200).json(mom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report-count-by-zone/:zone", async (req, res) => {
  try {
    const { zone } = req.params;
    const reportCount = await Report.countDocuments({ zone });

    res.status(200).json({ zone, reportCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report-count-by-pc/:pc", async (req, res) => {
  try {
    const { pc } = req.params;
    const reportCount = await Report.countDocuments({ pc });

    res.status(200).json({ pc, reportCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report-count-by-constituency/:constituency", async (req, res) => {
  try {
    const { constituency } = req.params;
    const reportCount = await Report.countDocuments({ constituency });

    res.status(200).json({ constituency, reportCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userRoles = req.user?.roles || [];

    // Check if user is admin
    if (userRoles.includes("admin")) {
      const moms = await Report.find().populate("userId");
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
    const moms = await Report.find(query).populate("userId");
    return res.status(200).json(moms);
  } catch (error) {
    console.error("Error fetching MOM data: ", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/get-booths-by-constituency/:constituency", async (req, res) => {
  const { constituency } = req.params;
  try {
    const booths = await Report.find({
      constituency: constituency.trim(),
    }).populate("userId");
    if (!booths.length) {
      return res
        .status(404)
        .json({ message: "No booths found for this constituency" });
    }
    res.status(200).json(booths);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




router.get("/get-report-by-party/:partyName", async (req, res) => {
  try {
    const { partyName } = req.params;
    const moms = await Report.find({ partyName }).populate("userId");

    const momCount = await Report.countDocuments({ partyName });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report-by-constituency/:constituency", async (req, res) => {
  try {
    const { constituency } = req.params;

    const moms = await Report.find({ constituency }).populate("userId");

    const momCount = await Report.countDocuments({ constituency });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.get("/get-report-by-zone/:zone", async (req, res) => {
  try {
    const { zone } = req.params;

    const moms = await Report.find({ zone });

    const momCount = await Report.countDocuments({ zone });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-report-by-pc/:pc", async (req, res) => {
  try {
    const { pc } = req.params;
    const moms = await Report.find({ pc }).populate("userId");

    const momCount = moms.length;

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-all-moms-count", async (req, res) => {
  try {
    const { pc, constituency } = req.query;
    let moms;

    if (pc) {
      moms = await Report.find({ pc }).populate("userId");
    } else if (constituency) {
      moms = await Report.find({ constituency }).populate("userId");
    } else {
      moms = await Report.find({});
    }
    const momCount = moms.length;
    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-report/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const updatedMom = await Report.findByIdAndUpdate(momId, req.body, {
      new: true,
    });
    res.status(200).json(updatedMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/delete-report/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const deletedMom = await Report.findByIdAndDelete(momId);
    if (!deletedMom) {
      return res.status(404).json({ error: "Report record not found" });
    }
    res.status(200).json({ message: "Report record deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;
