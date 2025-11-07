const express = require("express");
const router = express.Router();
const CandidatesDailyActivity = require("../models/CandidatesDailyActivity");
const BmcMapping = require("../models/BmcMapping");


// ---------- helpers ----------
const toArrayOfStrings = (val) => {
  if (val == null || val === "") return [];
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
};

const normalizePayload = (payload) => {
  const p = { ...payload };
  p.probableShsCandidateName      = toArrayOfStrings(p.probableShsCandidateName);
  p.shsDesignation                = toArrayOfStrings(p.shsDesignation);
  p.shsActivityType               = toArrayOfStrings(p.shsActivityType);
  p.shsActivityDetails            = toArrayOfStrings(p.shsActivityDetails);
  p.oppositionCandidateName       = toArrayOfStrings(p.oppositionCandidateName);
  p.candidateParty                = toArrayOfStrings(p.candidateParty);
  p.oppositionCandidateDesignation= toArrayOfStrings(p.oppositionCandidateDesignation);
  p.oppositionActivityType        = toArrayOfStrings(p.oppositionActivityType);
  p.oppositionActivityDetails     = toArrayOfStrings(p.oppositionActivityDetails);
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
    if (q.startDate) query.createdAt.$gte = new Date(q.startDate + "T00:00:00.000Z");
    if (q.endDate)   query.createdAt.$lte = new Date(q.endDate   + "T23:59:59.999Z");
  }

  return query;
};
const ciEq = (val) =>
  new RegExp(`^${String(val).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
// ---------- CRUD ----------
router.get("/lookup", async (req, res) => {
  try {
    const { pc, constituency } = req.query;

    // 1) If constituency is provided -> return WARDS (optionally also filter by PC)
    if (constituency) {
      const filter = { constituency: ciEq(constituency) };
      if (pc) filter.pc = ciEq(pc);

      const wards = await BmcMapping.distinct("wardNumber", filter);
      if (!wards || wards.length === 0) {
        return res.status(404).json({ message: "No wards found for the given criteria" });
      }

      wards.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      return res.status(200).json({
        ...(pc ? { pc } : {}),
        constituency,
        wards,
      });
    }

    // 2) If only PC is provided -> return CONSTITUENCIES for that PC
    if (pc) {
      const constituencies = await BmcMapping.distinct("constituency", { pc: ciEq(pc) });
      if (!constituencies || constituencies.length === 0) {
        return res.status(404).json({ message: "No constituencies found for the selected PC" });
      }

      constituencies.sort((a, b) => String(a).localeCompare(String(b)));
      return res.status(200).json({ pc, constituencies });
    }

    // 3) No params -> return all PCs
    const pcs = await BmcMapping.distinct("pc");
    if (!pcs || pcs.length === 0) {
      return res.status(404).json({ message: "No PCs found" });
    }

    pcs.sort((a, b) => String(a).localeCompare(String(b)));
    return res.status(200).json({ pcs });
  } catch (error) {
    console.error("Lookup error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Create
router.post("/add-candidates", async (req, res) => {
  try {
    const data = normalizePayload(req.body || {});
    const doc = await CandidatesDailyActivity.create(data);
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("Create error:", err);
    res.status(500).json({ success: false, message: "Failed to create entry." });
  }
});

// List (with filters, pagination, sort)
router.get("/get-all", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = "-createdAt", // newest first
      select,              // optional "field1 field2"
    } = req.query;

    const query = buildQuery(req.query);
    const skip = (Number(page) - 1) * Number(limit);

    const [items, total] = await Promise.all([
      CandidatesDailyActivity.find(query)
        .select(select || "")
        .sort(sort)
        .skip(skip)
        .limit(Number(limit)),
      CandidatesDailyActivity.countDocuments(query),
    ]);

    res.json({
      success: true,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)) || 1,
      },
      data: items,
    });
  } catch (err) {
    console.error("List error:", err);
    res.status(500).json({ success: false, message: "Failed to fetch entries." });
  }
});

// Get by id
router.get("/:id", async (req, res) => {
  try {
    const doc = await CandidatesDailyActivity.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
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
    );
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ success: false, message: "Failed to update entry." });
  }
});

// Delete
router.delete("/:id", async (req, res) => {
  try {
    const doc = await CandidatesDailyActivity.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found." });
    res.json({ success: true, message: "Deleted." });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ success: false, message: "Failed to delete entry." });
  }
});

// ---------- Daily Report convenience ----------
// GET /api/candidates-daily-activities/report/daily?date=2025-11-07&pc=&constituency=&ward=
router.get("/report/daily", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, message: "Query param 'date' (YYYY-MM-DD) is required." });
    }
    const start = new Date(date + "T00:00:00.000Z");
    const end   = new Date(date + "T23:59:59.999Z");

    const query = buildQuery({ ...req.query, startDate: date, endDate: date });
    const items = await CandidatesDailyActivity.find(query).sort("-createdAt");

    res.json({
      success: true,
      meta: { date, count: items.length, range: { start, end } },
      data: items,
    });
  } catch (err) {
    console.error("Daily report error:", err);
    res.status(500).json({ success: false, message: "Failed to build daily report." });
  }
});

module.exports = router;
