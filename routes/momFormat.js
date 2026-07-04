const express = require("express");
const router = express.Router();
const MomFormat = require("../models/MomFormat");
const NewMom = require("../models/NewMomModel");
const BoothsAp = require("../models/BoothListAP");
const User = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");
const punjabGeo = require("../utils/punjabGeo");
const multer = require("multer");
const AWS = require("aws-sdk");

const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.use(authenticateUser);

// State + role aware scope for MoM list/summary queries.
//  - Non-Punjab users: everything except Punjab (unchanged behaviour).
//  - Punjab admin/mod/state: all Punjab.
//  - Punjab Zonal/PCM: only their mapped regions/districts/ACs.
//  - Punjab user with no mapping: only their own records.
function punjabAwareStateScope(req) {
  const userState = (req.user && req.user.location) || "";
  if (userState !== "Punjab") return { state: { $ne: "Punjab" } };
  const sc = punjabGeo.punjabScope((req.user && req.user.roles) || []);
  if (sc.mode === "all") return { state: "Punjab" };
  if (sc.mode === "geo") return { state: "Punjab", ...sc.filter };
  return { state: "Punjab", createdByEmail: (req.user && req.user.email) || "__none__" };
}

// ---- Respondent photo upload (server-side S3; keys stay on the server) ----
router.post("/upload-photo", memUpload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    if (
      !process.env.AWS_ACCESS_KEY_ID ||
      !process.env.AWS_SECRET_ACCESS_KEY ||
      !process.env.AWS_REGION
    ) {
      return res
        .status(500)
        .json({ error: "Photo storage is not configured on the server." });
    }
    const s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    });
    const bucket = process.env.AWS_BUCKET || "mom-files-data-new";
    const safeName = (req.file.originalname || "photo").replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );
    const result = await s3
      .upload({
        Bucket: bucket,
        Key: `respondents/${Date.now()}_${safeName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
      .promise();
    res.status(200).json({ url: result.Location });
  } catch (error) {
    console.error("Photo upload failed:", error.message);
    res.status(500).json({ error: "Photo upload failed." });
  }
});

// ---- Create ----
router.post("/save", async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(403).json({ error: "Unauthorized user" });
    }
    const data = {
      ...req.body,
      userId: req.user._id,
      createdByEmail: req.body.email || req.user.email || "",
    };
    delete data.email;
    const saved = await MomFormat.create(data);
    res.status(201).json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- List only the new-format records ----
router.get("/list", async (req, res) => {
  try {
    const records = await MomFormat.find().sort({ createdAt: -1 });
    res.status(200).json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- All meetings: NEW format + LEGACY records, normalized for the dashboard ----
// NOTE: declared before "/:id" so it isn't captured as an id.
// Fetch a single meeting's photo on demand (kept out of the list for speed).
router.get("/meeting-photo/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const source = req.query.source || "format";
    let photo = "";
    if (source === "legacy") {
      const m = await NewMom.findById(id).select("leaderPhoto").lean();
      photo = (m && m.leaderPhoto) || "";
    } else {
      const r = await MomFormat.findById(id).select("respondentPhoto").lean();
      photo = (r && r.respondentPhoto) || "";
    }
    res.status(200).json({ photo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Build an Asia/Kolkata createdAt range filter from from/to (YYYY-MM-DD).
const dateRangeFilter = (from, to) => {
  if (!from && !to) return null;
  const f = {};
  if (from) f.$gte = new Date(`${from}T00:00:00+05:30`);
  if (to) f.$lte = new Date(`${to}T23:59:59.999+05:30`);
  return { createdAt: f };
};

// Lightweight true totals (no row loading) — fast count queries.
router.get("/meeting-summary", async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = dateRangeFilter(from, to) || {};
    const [fmtTotal, legTotal, legMom] = await Promise.all([
      MomFormat.countDocuments(range),
      NewMom.countDocuments(range),
      NewMom.countDocuments({ ...range, makeMom: "Yes" }),
    ]);
    // All MomFormat rows count as a submitted MoM.
    res.status(200).json({
      total: fmtTotal + legTotal,
      totalMom: fmtTotal + legMom,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/all-meetings", async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = dateRangeFilter(from, to);
    // Default (no date range): load only the most recent rows for speed.
    // With a date range: load everything in that bounded window.
    const DEFAULT_LIMIT = parseInt(req.query.limit, 10) || 3000;

    // State isolation: Punjab users see only Punjab meetings; everyone else
    // sees everything EXCEPT Punjab (so the pilot data stays separate). This
    // leaves the existing Maharashtra/AP/Bengal/UP experience unchanged.
    const stateScope = punjabAwareStateScope(req);

    // MomFormat (small collection) — always load all (optionally ranged).
    const fmt = await MomFormat.find(
      { ...(range || {}), ...stateScope },
      "createdByName createdAt location respondentName respondentDesignation meetingDate meetingTime gMapLocation reviewStatus zone pc region district"
    )
      .sort({ createdAt: -1 })
      .lean();
    const formatRows = fmt.map((r) => ({
      _id: r._id,
      source: "format",
      momSubmitted: true,
      createdByName: r.createdByName || "",
      createdAt: r.createdAt,
      location: r.location || "",
      respondentName: r.respondentName || "",
      respondentPhoto: "",
      respondentDesignation: r.respondentDesignation || "",
      meetingDate: r.meetingDate || "",
      meetingTime: r.meetingTime || "",
      gMapLocation: r.gMapLocation || "",
      reviewStatus: r.reviewStatus || "Not Reviewed",
      zone: r.zone || "",
      pc: r.pc || "",
      region: r.region || "",
      district: r.district || "",
    }));

    // Legacy records — tight projection, NO per-row populate (that was the
    // 181s bottleneck). Capped to recent N by default; full within a date range.
    let legacyQuery = NewMom.find(
      { ...(range || {}), ...stateScope },
      "makeMom userId createdAt constituency leaderName designation dom meetingStatus gMapLocation zone pc district"
    )
      .sort({ createdAt: -1 })
      .lean();
    if (!range) legacyQuery = legacyQuery.limit(DEFAULT_LIMIT);
    const legacy = await legacyQuery;

    // One query to resolve all creator names (instead of thousands).
    const legacyUserIds = [
      ...new Set(legacy.map((m) => m.userId).filter(Boolean).map(String)),
    ];
    const users = await User.find(
      { _id: { $in: legacyUserIds } },
      "userName"
    ).lean();
    const nameById = new Map(users.map((u) => [String(u._id), u.userName]));

    const legacyRows = legacy.map((m) => ({
      _id: m._id,
      source: "legacy",
      momSubmitted: m.makeMom === "Yes",
      createdByName:
        (m.userId && nameById.get(String(m.userId))) || "Unknown",
      createdAt: m.createdAt,
      location: m.constituency || "",
      respondentName: m.leaderName || "",
      respondentPhoto: "",
      respondentDesignation: m.designation || "",
      meetingDate: m.dom || "",
      meetingTime: "",
      gMapLocation: m.gMapLocation || "",
      reviewStatus: m.meetingStatus || "Not Reviewed",
      zone: m.zone || "",
      pc: m.pc || "",
      region: m.zone || "",
      district: m.district || "",
    }));

    const all = [...formatRows, ...legacyRows].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    res.status(200).json(all);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Summary of new-format meetings (same shape as /new-mom/get-mom rows) ----
// Per-employee counts for the Leader Meeting Report. State-scoped: Punjab users
// get Punjab team counts; everyone else gets non-Punjab counts.
router.get("/summary", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const stateScope = punjabAwareStateScope(req);
    const q = { ...stateScope };
    if (fromDate && toDate) q.meetingDate = { $gte: fromDate, $lte: toDate };
    const recs = await MomFormat.find(q);
    const grouped = {};
    recs.forEach((r) => {
      const key = `${r.pc || ""}-${r.region || ""}-${r.district || ""}-${r.location || ""}-${r.createdByName || ""}`;
      if (!grouped[key]) {
        grouped[key] = {
          pc: r.pc || "",
          region: r.region || "",
          district: r.district || "",
          constituency: r.location || "",
          userName: r.createdByName || "Unknown",
          reportingManager: punjabGeo.managerFor(r.createdByEmail),
          yes: 0,
          no: 0,
          nonShsCount: 0,
          dom: r.meetingDate || "",
        };
      }
      grouped[key].yes += 1; // every new-format record is a submitted MoM
    });
    res.status(200).json({ data: Object.values(grouped) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Stats for the welcome dashboard ----
router.get("/stats", async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const fmtTotal = await MomFormat.countDocuments();
    const fmtMonth = await MomFormat.countDocuments({
      createdAt: { $gte: startOfMonth },
    });
    let legacyTotal = 0;
    let legacyMonth = 0;
    try {
      legacyTotal = await NewMom.countDocuments({ makeMom: "Yes" });
      legacyMonth = await NewMom.countDocuments({
        makeMom: "Yes",
        createdAt: { $gte: startOfMonth },
      });
    } catch (e) {
      /* legacy optional */
    }
    res.status(200).json({
      totalMoms: fmtTotal + legacyTotal,
      momsThisMonth: fmtMonth + legacyMonth,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Zone -> PC -> AC hierarchy, derived from booth data ----
router.get("/geo-hierarchy", async (req, res) => {
  try {
    const rows = await BoothsAp.aggregate([
      {
        $group: {
          _id: { zone: "$zone", pc: "$pc", constituency: "$constituency" },
        },
      },
    ]);
    const tree = {};
    rows.forEach((r) => {
      const { zone, pc, constituency } = r._id || {};
      if (!zone || !pc || !constituency) return;
      tree[zone] = tree[zone] || {};
      tree[zone][pc] = tree[zone][pc] || new Set();
      tree[zone][pc].add(constituency);
    });
    const out = {};
    Object.keys(tree)
      .sort()
      .forEach((z) => {
        out[z] = {};
        Object.keys(tree[z])
          .sort()
          .forEach((p) => {
            out[z][p] = Array.from(tree[z][p]).sort();
          });
      });
    res.status(200).json(out);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Single record ----
router.get("/:id", async (req, res) => {
  try {
    const record = await MomFormat.findById(req.params.id);
    if (!record) return res.status(404).json({ error: "Not found" });
    res.status(200).json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Update review status only ----
router.patch("/:id/review", async (req, res) => {
  try {
    const { reviewStatus } = req.body;
    const updated = await MomFormat.findByIdAndUpdate(
      req.params.id,
      { reviewStatus },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.status(200).json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Full update ----
router.put("/:id", async (req, res) => {
  try {
    const record = await MomFormat.findById(req.params.id);
    if (!record) return res.status(404).json({ error: "Not found" });
    const body = { ...req.body };
    delete body.userId;
    delete body.email;
    delete body._id;
    Object.assign(record, body);
    await record.save();
    res.status(200).json(record);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Delete ----
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await MomFormat.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(200).json({ message: "Deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
