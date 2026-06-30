const express = require("express");
const router = express.Router();
const MomFormat = require("../models/MomFormat");
const NewMom = require("../models/NewMomModel");
const BoothsAp = require("../models/BoothListAP");
const authenticateUser = require("../middleware/authenticateUser");

router.use(authenticateUser);

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

router.get("/all-meetings", async (req, res) => {
  try {
    // Exclude the heavy photo blobs from the LIST payload (they can be large
    // base64 images; returning thousands of them caused a 504 timeout). The
    // list's photo column doesn't render the blob anyway. Use .lean() for speed.
    const fmt = await MomFormat.find()
      .select("-respondentPhoto")
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
    }));

    // Legacy records (also without the photo blob).
    const legacy = await NewMom.find()
      .select("-leaderPhoto")
      .populate("userId", "userName")
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();
    const legacyRows = legacy.map((m) => ({
      _id: m._id,
      source: "legacy",
      momSubmitted: m.makeMom === "Yes",
      createdByName: (m.userId && m.userId.userName) || "Unknown",
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
router.get("/summary", async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const q = {};
    if (fromDate && toDate) q.meetingDate = { $gte: fromDate, $lte: toDate };
    const recs = await MomFormat.find(q);
    const grouped = {};
    recs.forEach((r) => {
      const key = `${r.pc || ""}-${r.location || ""}-${r.createdByName || ""}`;
      if (!grouped[key]) {
        grouped[key] = {
          pc: r.pc || "",
          constituency: r.location || "",
          reportingManager: "",
          userName: r.createdByName || "Unknown",
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
