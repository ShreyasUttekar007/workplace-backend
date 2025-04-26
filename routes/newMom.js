const express = require("express");
const router = express.Router();
const Mom = require("../models/NewMomModel");
const { roles } = require("../models/User");
const User = require("../models/User");
const {
  zoneRoles,
  districtRoles,
  assemblyConstituencies,
  parliamentaryConstituencyRoles,
} = require("../models/roles");
const authenticateUser = require("../middleware/authenticateUser");
const EmployeeLeave = require("../models/EmployeeData");

router.use(authenticateUser);

router.post("/mom", async (req, res) => {
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

    const newMom = await Mom.create(momData);
    res.status(201).json(newMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-latest-mom/:userId", async (req, res) => {
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
    const reports = await Mom.find(query)
      .populate("userId")
      .sort({ createdAt: -1 });
    return res.status(200).json(reports);
  } catch (error) {
    console.error("Error fetching report data: ", error);
    return res.status(500).json({ error: error.message });
  }
});

router.get("/missing-gmap", async (req, res) => {
  try {
    const startDate = new Date("2025-04-12T00:00:00Z");
    const endDate = new Date();

    const entries = await Mom.find({
      gMapLocation: { $in: [null, "", undefined] },
      createdAt: {
        $gte: startDate,
        $lte: endDate,
      },
    }).populate("userId", "userName email location");

    const filteredEntries = entries.filter(entry => {
      if (!entry.userId || !entry.state) return false;
      const userLocation = entry.userId.location?.trim().toLowerCase();
      const entryState = entry.state?.trim().toLowerCase();
      return userLocation === entryState;
    });

    const grouped = {};
    const userList = [];

    for (const entry of filteredEntries) {
      const user = entry.userId;
      if (!user?._id) continue;

      if (!grouped[user._id]) {
        userList.push({
          userId: user._id,
          userName: user.userName,
          email: user.email,
          location: user.location,
        });

        grouped[user._id] = {
          userId: user._id,
          userName: user.userName,
          email: user.email,
          location: user.location,
          missingEntries: [],
        };
      }

      grouped[user._id].missingEntries.push({
        id: entry._id,
        state: entry.state,
        constituency: entry.constituency,
        createdAt: entry.createdAt,
      });
    }
    res.status(200).json({
      groupedEntries: Object.values(grouped),
      usersMissingGMap: userList,
    });

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

router.get("/get-users-with-zero-meeting", async (req, res) => {
  try {
    // Step 1: Get all users with department Soul Field
    const soulFieldEmployees = await EmployeeLeave.find({
      department: "Soul Field",
    });

    const soulEmails = soulFieldEmployees
      .map((emp) => emp.employeeEmail?.toLowerCase())
      .filter(Boolean);

    // Step 2: Get all users who have meetings (userId referenced in Mom)
    const usersWithMeetings = await Mom.distinct("userId");

    // Step 3: Get user details for all soulEmails
    const users = await User.find({
      email: { $in: soulEmails },
      _id: { $nin: usersWithMeetings }, // exclude users who already have meetings
    });

    // Step 4: Attach department and return
    const emailToDeptMap = {};
    soulFieldEmployees.forEach((emp) => {
      emailToDeptMap[emp.employeeEmail.toLowerCase()] = emp.department;
    });

    const result = users.map((user) => ({
      name: user.name,
      email: user.email,
      department: emailToDeptMap[user.email.toLowerCase()] || null,
    }));

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom", async (req, res) => {
  try {
    const { fromDate, toDate, constituency } = req.query;
    const loggedInUserLocation = req.user?.location?.toLowerCase();

    const filter = {};
    if (fromDate && toDate) {
      filter.createdAt = {
        $gte: new Date(new Date(fromDate).setHours(0, 0, 0, 0)),
        $lte: new Date(new Date(toDate).setHours(23, 59, 59, 999)),
      };
    }

    // Fetch MoMs with user info
    const moms = await Mom.find(filter).populate("userId");

    // Filter based on user location (state)
    let filteredMoms = moms.filter(
      (mom) => mom.userId?.location?.toLowerCase() === loggedInUserLocation
    );

    // If constituency filter is given, apply it
    if (constituency) {
      filteredMoms = filteredMoms.filter(
        (mom) => mom.constituency?.toLowerCase() === constituency.toLowerCase()
      );
    }

    // Build employee mapping
    const userEmails = filteredMoms
      .map((mom) => mom.userId?.email?.toLowerCase())
      .filter(Boolean);

    const employeeData = await EmployeeLeave.find({
      employeeEmail: { $in: userEmails },
    });

    const employeeMap = {};
    employeeData.forEach((emp) => {
      employeeMap[emp.employeeEmail.toLowerCase()] = {
        reportingManager: emp.reportingManager,
        reportingManagerEmail: emp.reportingManagerEmail,
      };
    });

    // Grouping logic
    const grouped = {};

    filteredMoms.forEach((mom) => {
      const key = `${mom.pc}-${mom.ac}-${mom.userId?._id}-${mom.constituency}`;

      if (!grouped[key]) {
        grouped[key] = {
          pc: mom.pc,
          ac: mom.ac,
          constituency: mom.constituency || "",
          reportingManager: null,
          reportingManagerEmail: null,
          userName: mom.userId?.userName || "Unknown",
          yes: 0,
          no: 0,
          nonShsCount: 0,
          createdAt: mom.createdAt,
        };
      }

      if (mom.makeMom === "Yes") {
        grouped[key].yes++;
      } else if (mom.makeMom === "No") {
        grouped[key].no++;
      }

      if (mom.partyName && mom.partyName.toLowerCase() !== "shs") {
        grouped[key].nonShsCount++;
      }

      const email = mom.userId?.email?.toLowerCase();
      const managerData = email ? employeeMap[email] : null;
      grouped[key].reportingManager = managerData?.reportingManager || null;
      grouped[key].reportingManagerEmail = managerData?.reportingManagerEmail || null;
    });

    const result = Object.values(grouped);

    res.status(200).json({ data: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.get("/get-mom-by-id/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const mom = await Mom.findById(momId).populate("userId");

    if (!mom) {
      return res.status(404).json({ error: "MOM not found" });
    }

    res.status(200).json(mom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



router.get("/get-mom-by-party/:partyName", async (req, res) => {
  try {
    const { partyName } = req.params;
    const moms = await Mom.find({ partyName }).populate("userId");

    const momCount = await Mom.countDocuments({ partyName });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-by-constituency/:constituency", async (req, res) => {
  try {
    const { constituency } = req.params;

    const moms = await Mom.find({ constituency }).populate("userId").sort({ createdAt: -1 });

    const momCount = await Mom.countDocuments({ constituency });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-by-zone/:zone", async (req, res) => {
  try {
    const { zone } = req.params;

    const moms = await Mom.find({ zone }).populate("userId").sort({ createdAt: -1 });

    const momCount = await Mom.countDocuments({ zone });

    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-count-by-zone/:zone", async (req, res) => {
  try {
    const { zone } = req.params;
    const momCount = await Mom.countDocuments({ zone });

    res.status(200).json({ zone, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-count-by-pc/:pc", async (req, res) => {
  try {
    const { pc } = req.params;
    const momCount = await Mom.countDocuments({ pc });

    res.status(200).json({ pc, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-count-by-constituency/:constituency", async (req, res) => {
  try {
    const { constituency } = req.params;
    const momCount = await Mom.countDocuments({ constituency });

    res.status(200).json({ constituency, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-mom-by-pc/:pc", async (req, res) => {
  try {
    const { pc } = req.params;
    const moms = await Mom.find({ pc }).populate("userId").sort({ createdAt: -1 }); ;

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
      moms = await Mom.find({ pc }).populate("userId");
    } else if (constituency) {
      moms = await Mom.find({ constituency }).populate("userId");
    } else {
      moms = await Mom.find({});
    }
    const momCount = moms.length;
    res.status(200).json({ moms, momCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-mom/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const updatedMom = await Mom.findByIdAndUpdate(momId, req.body, {
      new: true,
    });
    res.status(200).json(updatedMom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/delete-mom/:momId", async (req, res) => {
  try {
    const { momId } = req.params;
    const deletedMom = await Mom.findByIdAndDelete(momId);
    if (!deletedMom) {
      return res.status(404).json({ error: "Mom record not found" });
    }
    res.status(200).json({ message: "Mom record deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
