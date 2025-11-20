const express = require("express");
const router = express.Router();
const CandidatesDailyActivity = require("../models/CandidatesDailyActivity");
const BmcMapping = require("../models/BmcMapping");
const User = require("../models/User");
const {
  zoneRoles,
  districtRoles,
  assemblyConstituencies,
  parliamentaryConstituencyRoles,
} = require("../models/roles");
const authenticateUser = require("../middleware/authenticateUser");

/* ---------------------- helpers ---------------------- */

const toArrayOfStrings = (val) => {
  if (val == null || val === "") return [];
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
};

const normalizePayload = (payload) => {
  const p = { ...payload };
  p.probableShsCandidateName = toArrayOfStrings(p.probableShsCandidateName);
  p.shsDesignation = toArrayOfStrings(p.shsDesignation);
  p.shsActivityType = toArrayOfStrings(p.shsActivityType);
  p.shsActivityDetails = toArrayOfStrings(p.shsActivityDetails);
  p.oppositionCandidateName = toArrayOfStrings(p.oppositionCandidateName);
  p.candidateParty = toArrayOfStrings(p.candidateParty);
  p.oppositionCandidateDesignation = toArrayOfStrings(
    p.oppositionCandidateDesignation
  );
  p.oppositionActivityType = toArrayOfStrings(p.oppositionActivityType);
  p.oppositionActivityDetails = toArrayOfStrings(p.oppositionActivityDetails);
  return p;
};

const buildQuery = (q) => {
  const query = {};
  if (q.pc) query.pc = q.pc;
  if (q.constituency) query.constituency = q.constituency;
  if (q.ward) query.ward = q.ward;

  // date range (createdAt)
  if (q.startDate || q.endDate) {
    query.createdAt = {};
    if (q.startDate)
      query.createdAt.$gte = new Date(q.startDate + "T00:00:00.000Z");
    if (q.endDate)
      query.createdAt.$lte = new Date(q.endDate + "T23:59:59.999Z");
  }

  return query;
};



const parseWard = (ward) => {
  if (ward === undefined || ward === null) return null;
  const num = String(ward).match(/\d+/);
  return num ? Number(num[0]) : String(ward).trim();
};

/* ---------------------- lookup endpoints ---------------------- */

router.get("/lookup", async (req, res) => {
  try {
    const { pc, constituency } = req.query;

    // 1) constituency -> wards (optionally filter by PC)
    if (constituency) {
      const filter = { constituency: ciEq(constituency) };
      if (pc) filter.pc = ciEq(pc);

      const wards = await BmcMapping.distinct("wardNumber", filter);
      if (!wards?.length) {
        return res
          .status(404)
          .json({ message: "No wards found for the given criteria" });
      }
      wards.sort((a, b) =>
        String(a).localeCompare(String(b), undefined, { numeric: true })
      );
      return res.status(200).json({ ...(pc ? { pc } : {}), constituency, wards });
    }

    // 2) only PC -> constituencies
    if (pc) {
      const constituencies = await BmcMapping.distinct("constituency", {
        pc: ciEq(pc),
      });
      if (!constituencies?.length) {
        return res
          .status(404)
          .json({ message: "No constituencies found for the selected PC" });
      }
      constituencies.sort((a, b) => String(a).localeCompare(String(b)));
      return res.status(200).json({ pc, constituencies });
    }

    // 3) no params -> all PCs
    const pcs = await BmcMapping.distinct("pc");
    if (!pcs?.length) return res.status(404).json({ message: "No PCs found" });
    pcs.sort((a, b) => String(a).localeCompare(String(b)));
    return res.status(200).json({ pcs });
  } catch (error) {
    console.error("Lookup error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/**
 * GET /candidates-daily-activities/bmcmapping-by-ward
 * Query: ward (required), pc (optional), constituency (optional)
 */
router.get("/bmcmapping-by-ward", async (req, res) => {
  try {
    const { ward, pc, constituency } = req.query;
    if (!ward) {
      return res
        .status(400)
        .json({ success: false, message: "Missing 'ward' query param" });
    }

    const parsedWard = parseWard(ward);
    const orWard = [];

    if (typeof parsedWard === "number" && !Number.isNaN(parsedWard)) {
      orWard.push({ wardNumber: parsedWard }, { wardNumber: String(parsedWard) });
    } else {
      orWard.push({ wardNumber: ciEq(parsedWard) }, { wardName: ciEq(parsedWard) });
    }

    const filter = { $or: orWard };
    if (pc) filter.pc = ciEq(pc);
    if (constituency) filter.constituency = ciEq(constituency);

    const doc = await BmcMapping.findOne(filter)
      .select(
        "pc constituency wardNumber wardName corporatorName previousWinningParty corporatorCurrentParty updatedAt createdAt"
      )
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "No corporator mapping found for the given ward/filters",
        query: { ward, pc, constituency },
      });
    }

    return res.json({
      success: true,
      data: {
        pc: doc.pc ?? null,
        constituency: doc.constituency ?? null,
        wardNumber: doc.wardNumber ?? null,
        wardName: doc.wardName ?? null,
        corporatorName: doc.corporatorName ?? "",
        previousWinningParty: doc.previousWinningParty ?? "",
        corporatorCurrentParty: doc.corporatorCurrentParty ?? "",
        updatedAt: doc.updatedAt ?? null,
        createdAt: doc.createdAt ?? null,
      },
    });
  } catch (err) {
    console.error("bmcmapping-by-ward error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ---------------------- CRUD ---------------------- */

// Create
router.post("/add-candidates", async (req, res) => {
  try {
    const data = normalizePayload(req.body || {});
    const doc = await CandidatesDailyActivity.create(data);
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("Create error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to create entry." });
  }
});

// helper: case-insensitive equals
const ciEq = (val) =>
  new RegExp(
    `^${String(val).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i"
  );


// router.get("/get-all", authenticateUser, async (req, res) => {
//   try {
//     const userIdParam = String(req.query.userId || req.user?._id || "");
//     const userRoles = req.user?.roles || [];
//     const userLocation = req.user?.location;

//     // Build query exactly like get-latest-mom
//     const query = {};
//     const allowedStates = ["Maharashtra", "Andhra Pradesh", "Bengal", "Uttar Pradesh"];
//     if (allowedStates.includes(userLocation)) {
//       query.state = userLocation; // exact state filter for everyone (incl. admin)
//     }

//     // Verify user exists (same as MoM)
//     const me = await User.findById(req.user._id).select("roles location");
//     if (!me) {
//       return res.status(404).json({ success: false, message: "User not found" });
//     }

//     // Role-scoped filters (same fields assumed on CDA docs)
//     const userZoneRoles = userRoles.filter((r) => zoneRoles.includes(r));
//     const userDistrictRoles = userRoles.filter((r) => districtRoles.includes(r));
//     const userConstituencyRoles = userRoles.filter((r) => assemblyConstituencies.includes(r));
//     const userParliamentaryConstituencyRoles = userRoles.filter((r) =>
//       parliamentaryConstituencyRoles.includes(r)
//     );

//     if (userZoneRoles.length > 0) query.zone = { $in: userZoneRoles };
//     if (userDistrictRoles.length > 0) query.district = { $in: userDistrictRoles };
//     if (userConstituencyRoles.length > 0) query.constituency = { $in: userConstituencyRoles };
//     if (userParliamentaryConstituencyRoles.length > 0) query.pc = { $in: userParliamentaryConstituencyRoles };

//     // Admins can see all in their state; non-admins only themselves
//     const isAdmin = userRoles.includes("admin");
//     if (!isAdmin && userIdParam !== String(req.user._id)) {
//       return res.status(403).json({ success: false, message: "Forbidden - Unauthorized user" });
//     }

//     // If not admin and only 'state' exists so far, pin to own docs
//     if (!isAdmin && Object.keys(query).length === 1) {
//       query.userId = req.user._id;
//     }

//     // Fetch & return (no pagination; newest first), same as MoM
//     const items = await CandidatesDailyActivity.find(query)
//       .populate("userId")
//       .sort({ createdAt: -1 });

//     return res.status(200).json({ success: true, data: items });
//   } catch (error) {
//     console.error("[/get-all] error:", error);
//     return res.status(500).json({ success: false, message: error.message || "Server error" });
//   }
// });

// Get by id


// GET /candidates-daily-activities/get-latest-candidate/:userId
// GET /candidates-daily-activities/get-latest-candidate/:userId
router.get("/get-latest-candidate/:userId", authenticateUser, async (req, res) => {
  try {
    const me = await User.findById(req.user?._id).select("roles location");
    if (!me) return res.status(404).json({ error: "User not found" });

    const roles = Array.isArray(me.roles) ? me.roles : [];
    const isAdmin = roles.includes("admin");
    const targetUserId = String(req.params.userId || req.user._id);

    if (!isAdmin && targetUserId !== String(req.user._id)) {
      return res.status(403).json({ error: "Forbidden - Unauthorized user" });
    }

    // Build query ONLY with fields that exist in CandidatesDailyActivity
    const query = {};

    // map roles to pc / constituency constraints
    const userACRoles = roles.filter((r) => assemblyConstituencies.includes(r));
    const userPCRoles = roles.filter((r) => parliamentaryConstituencyRoles.includes(r));
    if (userACRoles.length) query.constituency = { $in: userACRoles };
    if (userPCRoles.length) query.pc = { $in: userPCRoles };

    // DO NOT add state/zone/district/userId here (not in this schema)

    const docs = await CandidatesDailyActivity.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(docs);
  } catch (err) {
    console.error("get-latest-candidate error:", err);
    return res.status(500).json({ error: err.message });
  }
});



router.get("/get-one/:id", async (req, res) => {
  try {
    const doc = await CandidatesDailyActivity.findById(req.params.id).lean();
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("Get error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch entry." });
  }
});

// Update
router.put("/:id", async (req, res) => {
  try {
    const data = normalizePayload(req.body || {});
    const doc = await CandidatesDailyActivity.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { new: true }
    ).lean();
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("Update error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to update entry." });
  }
});

// Delete
router.delete("/:id", async (req, res) => {
  try {
    const doc = await CandidatesDailyActivity.findByIdAndDelete(
      req.params.id
    ).lean();
    if (!doc)
      return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, message: "Deleted." });
  } catch (err) {
    console.error("Delete error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete entry." });
  }
});

/* ---------------------- daily report ---------------------- */
// GET /api/candidates-daily-activities/report/daily?date=2025-11-07&pc=&constituency=&ward=
router.get("/report/daily", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Query param 'date' (YYYY-MM-DD) is required.",
      });
    }
    const start = new Date(date + "T00:00:00.000Z");
    const end = new Date(date + "T23:59:59.999Z");

    const query = buildQuery({ ...req.query, startDate: date, endDate: date });
    const items = await CandidatesDailyActivity.find(query)
      .sort("-createdAt")
      .lean();

    res.json({
      success: true,
      meta: { date, count: items.length, range: { start, end } },
      data: items,
    });
  } catch (err) {
    console.error("Daily report error:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to build daily report." });
  }
});

module.exports = router;
