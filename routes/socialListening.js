const express = require("express");
const router = express.Router();
const Social = require("../models/SocialListening");
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

router.post("/add-social-entry", async (req, res) => {
  try {
    const socialData = req.body;

    if (!socialData.userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized - User not found" });
    }

    if (socialData.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    const newSocial = await Social.create(socialData);
    res.status(201).json(newSocial);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-latest-social/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userRoles = req.user?.roles || [];
    const userLocation = req.user?.location;

    // Construct the query dynamically
    const query = {};

    // Ensure state-based filtering for all users, including admin
    const allowedStates = ["Maharashtra", "Andhra Pradesh", "Bengal", "Uttar Pradesh"]; // <-- Added Uttar Pradesh
    if (allowedStates.includes(userLocation)) {
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
    const reports = await Social.find(query)
      .populate("userId")
      .sort({ createdAt: -1 });

    return res.status(200).json(reports);
  } catch (error) {
    console.error("Error fetching report data: ", error);
    return res.status(500).json({ error: error.message });
  }
});

const allowedStates = ["Maharashtra", "Andhra Pradesh", "Bengal", "Uttar Pradesh"];

// Utility: parse dd-mm-yyyy → Date (00:00 time)
function parseDMY(dmy) {
  if (!dmy || typeof dmy !== "string") return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy.trim());
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return isNaN(d) ? null : d;
}

/**
 * GET /social-listening/dashboard/:userId
 * State-scoped, role-aware listing for dashboard
 * Optional filters via query:
 *   zone, district, constituency
 *   dateFrom (dd-mm-yyyy), dateTo (dd-mm-yyyy)
 *   page (default 1), limit (default 1000), sort (default -createdAt)
 *
 * Returns:
 *  {
 *    success: true,
 *    counts: { total, positive, neutral, negative },
 *    options: { zones: [...], districts: [...], constituencies: [...] },
 *    pagination: { page, limit, total, pages },
 *    items: [...]
 *  }
 */
router.get("/dashboard/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // auth/user is expected from your auth middleware
    const user = await User.findById(req.user?._id).select("roles location");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const userRoles = user.roles || [];
    const userLocation = user.location;

    // ---- Base query (state-scoped) ----
    const query = {};

    if (allowedStates.includes(userLocation)) {
      query.state = userLocation;
    }

    // ---- Role → scope mapping ----
    const userZoneRoles = userRoles.filter((r) => zoneRoles.includes(r));
    const userDistrictRoles = userRoles.filter((r) => districtRoles.includes(r));
    const userConstituencyRoles = userRoles.filter((r) =>
      assemblyConstituencies.includes(r)
    );
    const userPcRoles = userRoles.filter((r) =>
      parliamentaryConstituencyRoles.includes(r)
    );

    if (userZoneRoles.length) query.zone = { $in: userZoneRoles };
    if (userDistrictRoles.length) query.district = { $in: userDistrictRoles };
    if (userConstituencyRoles.length) query.constituency = { $in: userConstituencyRoles };
    if (userPcRoles.length) query.pc = { $in: userPcRoles };

    // ---- Admin can see all in their state. Non-admin locked to own user if only state is present ----
    const isAdmin = userRoles.includes("admin");
    if (!isAdmin && userId !== String(req.user._id)) {
      return res.status(403).json({ success: false, message: "Forbidden - Unauthorized user" });
    }
    if (!isAdmin && Object.keys(query).length === 1 && query.state) {
      query.userId = new mongoose.Types.ObjectId(userId);
    }

    // ---- Dashboard filters ----
    const {
      zone,
      district,
      constituency,
      dateFrom,   // dd-mm-yyyy
      dateTo,     // dd-mm-yyyy
      page = 1,
      limit = 1000,
      sort = "-createdAt",
    } = req.query;

    if (zone) query.zone = zone;                         // further narrow
    if (district) query.district = district;
    if (constituency) query.constituency = constituency;

    // Date filter: dateOfMeeting is string; try server-side by range if stored as DD-MM-YYYY
    // We'll filter by createdAt as fallback if no dateOfMeeting match is possible on server.
    // Approach: fetch wide, then refine in-memory by dateOfMeeting string for accuracy.

    const skip = (Number(page) - 1) * Number(limit);

    // Fetch items (wide), then refine by date range
    const baseItems = await Social.find(query)
      .sort(sort)
      .skip(skip)
      .limit(Number(limit));

    // In-memory date range filter on dateOfMeeting (dd-mm-yyyy) with fallback to createdAt
    let items = baseItems;
    if (dateFrom || dateTo) {
      const df = dateFrom ? parseDMY(dateFrom) : null;
      const dt = dateTo ? parseDMY(dateTo) : null;
      items = baseItems.filter((e) => {
        let d = parseDMY(e.dateOfMeeting);
        if (!d) {
          // fallback to createdAt
          const nat = new Date(e.createdAt);
          d = isNaN(nat) ? null : nat;
        }
        if (!d) return false;
        if (df && d < new Date(df.setHours(0, 0, 0, 0))) return false;
        if (dt && d > new Date(dt.setHours(23, 59, 59, 999))) return false;
        return true;
      });
    }

    // Total count for pagination (without page/limit). If you want exact count after date range,
    // either refetch without skip/limit or compute from full set (costly). Here we approximate:
    const totalUnpaged = await Social.countDocuments(query);
    // pages based on DB total; if you need date-range-accurate pages, do a second query without skip/limit and then slice.

    // ---- Counts (SP Perception) ----
    const total = items.length;
    const positive = items.filter((e) => (e.spPerception || "").toLowerCase() === "positive").length;
    const neutral = items.filter((e) => (e.spPerception || "").toLowerCase() === "neutral").length;
    const negative = items.filter((e) => (e.spPerception || "").toLowerCase() === "negative").length;

    // ---- Distinct options for filters (from state+role-scoped universe, not only page) ----
    const universe = await Social.find(query).select("zone district constituency").limit(5000);
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { numeric: true })
    );
    const options = {
      zones: uniq(universe.map((x) => x.zone)),
      districts: uniq(universe.map((x) => x.district)),
      constituencies: uniq(universe.map((x) => x.constituency)),
    };

    return res.status(200).json({
      success: true,
      counts: { total, positive, neutral, negative },
      options,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalUnpaged,               // DB total (pre date-range). Replace if you want date-range exact.
        pages: Math.max(1, Math.ceil(totalUnpaged / Number(limit))),
      },
      items,
    });
  } catch (error) {
    console.error("Social dashboard error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;