const express = require("express");
const router = express.Router();
const multer = require("multer");
const authenticateUser = require("../middleware/authenticateUser");
const punjabGeo = require("../utils/punjabGeo");
const acMapping = require("../utils/acMapping");
const BoothList = require("../models/PunjabBoothList");
const BoothDetails = require("../models/PunjabBoothDetails");
const User = require("../models/User");

router.use(authenticateUser);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const UPLOAD_ADMINS = ["pardhasaradhi@showtimeconsulting.in"];
const isUploadAdmin = (req) =>
  (req.user?.roles || []).includes("admin") ||
  UPLOAD_ADMINS.includes((req.user?.email || "").toLowerCase());

// Reporting managers who can see ALL filled booth data.
// TODO: add the login emails for Shalini, Anurag, Robbin, Rajvardhan Chauhan.
const MANAGER_EMAILS = [
  "pardhasaradhi@showtimeconsulting.in",
  // "shalini@showtimeconsulting.in",
  // "anurag@showtimeconsulting.in",
  // "robbin@showtimeconsulting.in",
  // "rajvardhan.chauhan@showtimeconsulting.in",
];
const isManagerViewer = (req) => {
  const roles = req.user?.roles || [];
  const email = (req.user?.email || "").toLowerCase();
  return (
    roles.includes("admin") ||
    roles.includes("mod") ||
    roles.includes("state") ||
    MANAGER_EMAILS.includes(email)
  );
};

function myAcNo(req) {
  const m = acMapping.acForEmail(req.user?.email || "");
  return m ? Number(m.acNo) : null;
}

function parseCSV(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ""));
}

const parsePart = (raw) => {
  const s = String(raw || "").trim();
  const m = s.match(/^(\d+)\s*-\s*(.*)$/);
  if (m) return { partNo: parseInt(m[1], 10), partName: m[2].trim(), partRaw: s };
  return { partNo: null, partName: s, partRaw: s };
};

router.get("/geo", async (req, res) => {
  try {
    const byDistrict = {};
    (punjabGeo.acList() || []).forEach((a) => {
      if (!byDistrict[a.district]) byDistrict[a.district] = [];
      byDistrict[a.district].push({ ac_no: a.ac_no, ac_name: a.ac_name });
    });
    Object.values(byDistrict).forEach((l) => l.sort((x, y) => (x.ac_no || 0) - (y.ac_no || 0)));
    res.json({ districts: Object.keys(byDistrict).sort(), byDistrict });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!isUploadAdmin(req)) return res.status(403).json({ error: "Not authorised to upload." });
    const district = (req.body.district || "").trim();
    const ac = (req.body.ac || "").trim();
    const acNo = parseInt(req.body.acNo, 10);
    if (!district || !ac || Number.isNaN(acNo)) {
      return res.status(400).json({ error: "District, Assembly and AC number are required." });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const rows = parseCSV(req.file.buffer.toString("utf8"));
    if (!rows.length) return res.status(400).json({ error: "Empty file." });
    const header = rows[0].map((h) => String(h).trim().toLowerCase());
    const partIdx = header.indexOf("part");
    if (partIdx === -1) return res.status(400).json({ error: "CSV must have a 'Part' column." });

    const docs = [];
    const seen = new Set();
    for (let i = 1; i < rows.length; i++) {
      const raw = rows[i][partIdx];
      if (!raw || !String(raw).trim()) continue;
      const { partNo, partName, partRaw } = parsePart(raw);
      if (partNo == null || seen.has(partNo)) continue;
      seen.add(partNo);
      docs.push({ district, ac, acNo, partNo, partName, partRaw });
    }
    if (!docs.length) return res.status(400).json({ error: "No valid Part rows found." });

    await BoothList.deleteMany({ acNo });
    await BoothList.insertMany(docs);
    res.json({ message: `Uploaded ${docs.length} booths for ${ac}.`, count: docs.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/my-booths", async (req, res) => {
  try {
    let acNo = myAcNo(req);
    const override = parseInt(req.query.acNo, 10);
    if (!Number.isNaN(override) && isUploadAdmin(req)) acNo = override;

    if (acNo == null) {
      return res.json({ assigned: false, acNo: null, ac: "", district: "", booths: [] });
    }
    const booths = await BoothList.find({ acNo }).sort({ partNo: 1 }).lean();
    const info = acMapping.infoForAcNo(acNo);
    const ac = (booths[0] && booths[0].ac) || (info && info.acName) || "";
    const district = (booths[0] && booths[0].district) || "";
    res.json({ assigned: true, acNo, ac, district, booths });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/details", async (req, res) => {
  try {
    const acNo = parseInt(req.query.acNo, 10);
    const partNo = parseInt(req.query.partNo, 10);
    if (Number.isNaN(acNo) || Number.isNaN(partNo)) {
      return res.status(400).json({ error: "acNo and partNo are required." });
    }
    const doc = await BoothDetails.findOne({ acNo, partNo }).lean();
    res.json({ details: doc || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const FIELDS = [
  "voterListReceivedAtOffice", "voterListDistributed", "casteCensusStatus",
  "voterListReceived", "boothPradhanAppointed", "womenBoothPradhanAppointed",
  "scBoothPradhanAppointed", "bcBoothPradhanAppointed", "youthBoothPradhanAppointed",
  "committee11Formed", "circleInchargeMapped",
  "circleInchargeName", "boothPocName", "remark",
];

router.post("/details", async (req, res) => {
  try {
    const acNo = parseInt(req.body.acNo, 10);
    const partNo = parseInt(req.body.partNo, 10);
    const status = req.body.status === "submitted" ? "submitted" : "draft";
    if (Number.isNaN(acNo) || Number.isNaN(partNo)) {
      return res.status(400).json({ error: "acNo and partNo are required." });
    }
    if (myAcNo(req) !== acNo && !isUploadAdmin(req)) {
      return res.status(403).json({ error: "This assembly is not assigned to you." });
    }
    const existing = await BoothDetails.findOne({ acNo, partNo });
    if (existing && existing.status === "submitted" && !isUploadAdmin(req)) {
      return res.status(409).json({ error: "This booth was already submitted and is locked." });
    }

    const update = { acNo, partNo, status };
    update.partRaw = req.body.partRaw || (existing && existing.partRaw) || "";
    update.ac = req.body.ac || (existing && existing.ac) || "";
    update.district = req.body.district || (existing && existing.district) || "";
    FIELDS.forEach((f) => { if (req.body[f] !== undefined) update[f] = req.body[f]; });
    update.filledByEmail = req.user?.email || "";
    update.filledByName = req.user?.name || req.user?.userName || req.user?.email || "";
    if (status === "submitted") update.submittedAt = new Date();

    const doc = await BoothDetails.findOneAndUpdate(
      { acNo, partNo },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ message: status === "submitted" ? "Submitted." : "Saved.", details: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Reporting-manager view: ALL filled booth data for a chosen assembly ----
router.get("/manager-data", async (req, res) => {
  try {
    if (!isManagerViewer(req)) {
      return res.status(403).json({ error: "Not authorised to view booth data." });
    }
    const acNo = parseInt(req.query.acNo, 10);
    if (Number.isNaN(acNo)) return res.status(400).json({ error: "acNo is required." });

    const booths = await BoothList.find({ acNo }).sort({ partNo: 1 }).lean();
    const details = await BoothDetails.find({ acNo }).lean();
    const byPart = {};
    details.forEach((d) => { byPart[d.partNo] = d; });

    const info = acMapping.infoForAcNo(acNo);
    let acmName = info ? info.acmName : "";
    const ac = (booths[0] && booths[0].ac) || (info && info.acName) || "";
    const district = (booths[0] && booths[0].district) || "";

    // Fallback: if the mapping has no ACM for this AC, use the Punjab user whose
    // role is this assembly (the resource mapped to it).
    if (!acmName && ac) {
      try {
        const u = await User.findOne({ roles: ac }).lean();
        if (u) acmName = u.userName || u.name || "";
      } catch (e) {
        /* ignore */
      }
    }

    const rows = booths.map((b) => {
      const d = byPart[b.partNo] || {};
      return {
        acm: acmName || d.filledByName || "",
        partNo: b.partNo,
        partName: b.partName,
        voterListReceivedAtOffice: d.voterListReceivedAtOffice || "",
        voterListDistributed: d.voterListDistributed || "",
        casteCensusStatus: d.casteCensusStatus || "",
        voterListReceived: d.voterListReceived || "",
        boothPradhanAppointed: d.boothPradhanAppointed || "",
        womenBoothPradhanAppointed: d.womenBoothPradhanAppointed || "",
        scBoothPradhanAppointed: d.scBoothPradhanAppointed || "",
        bcBoothPradhanAppointed: d.bcBoothPradhanAppointed || "",
        youthBoothPradhanAppointed: d.youthBoothPradhanAppointed || "",
        committee11Formed: d.committee11Formed || "",
        circleInchargeMapped: d.circleInchargeMapped || "",
        circleInchargeName: d.circleInchargeName || "",
        boothPocName: d.boothPocName || "",
        remark: d.remark || "",
        status: d.status || "",
      };
    });

    res.json({ acNo, ac, district, acmName, rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
