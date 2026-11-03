const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authenticateUser");
const MomFormat = require("../models/MomFormat");
const MomEmbedding = require("../models/MomEmbedding");
const { embed, cosine, MODEL_NAME } = require("../utils/embeddings");
const { punjabAwareStateScope } = require("../utils/momScope");
const { callModel, aiProvider } = require("../utils/momSummarizer");

router.use(authenticateUser);

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const EMPTY = "_empty"; // marker for meetings that had no embeddable text
// Index maintenance: admin or mod (the same roles that manage other portal data).
const isAdmin = (req) => {
  const r = req.user?.roles || [];
  return r.includes("admin") || r.includes("mod");
};

/* ---------------------------- chunk building ---------------------------- */

function chunksFor(rec) {
  const base = {
    momId: rec._id,
    state: clean(rec.state),
    createdByEmail: clean(rec.createdByEmail),
    createdByName: clean(rec.createdByName),
    zone: clean(rec.zone),
    pc: clean(rec.pc),
    location: clean(rec.location),
    district: clean(rec.district),
    meetingDate: clean(rec.meetingDate) ||
      (rec.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : ""),
    respondentName: clean(rec.respondentName),
    respondentDesignation: clean(rec.respondentDesignation),
    respondentParty: clean(rec.respondentParty),
    model: MODEL_NAME,
  };

  const out = [];
  const add = (text, chunkType, extra = {}) => {
    const t = clean(text);
    if (t.length < 8) return;
    out.push({ ...base, ...extra, chunkType, text: t });
  };

  (rec.discussionPoints || []).forEach((d) =>
    add([clean(d.point), clean(d.details)].filter(Boolean).join(" — "), "discussion"));
  (rec.stcActionables || []).forEach((a) =>
    add(clean(a.issue), "stc_actionable",
      { actionable: clean(a.actionable), timeline: clean(a.timeline) }));
  (rec.leaderActionables || []).forEach((a) =>
    add(clean(a.issue), "leader_actionable",
      { actionable: clean(a.actionable), timeline: clean(a.timeline) }));
  if (clean(rec.remarks)) add(rec.remarks, "remark");
  return out;
}

/* ------------------------------- indexing ------------------------------- */

// Index status: how much of the corpus is embedded.
router.get("/status", async (req, res) => {
  try {
    const [meetings, chunks, indexedMeetings, emptyMeetings] = await Promise.all([
      MomFormat.countDocuments({}),
      MomEmbedding.countDocuments({ chunkType: { $ne: EMPTY } }),
      MomEmbedding.distinct("momId").then((a) => a.length),
      MomEmbedding.countDocuments({ chunkType: EMPTY }),
    ]);
    res.json({
      meetings, chunks, indexedMeetings, emptyMeetings,
      pending: Math.max(meetings - indexedMeetings, 0),
      model: MODEL_NAME,
      ai: { provider: aiProvider() || "none" },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Build / top up the index. Admin only.
 * Processes in batches so it never blocks the event loop for long; call
 * repeatedly (or with ?all=1) until "pending" reaches 0.
 */
router.post("/reindex", async (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin or mod only." });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rebuild = req.query.rebuild === "1";

    if (rebuild) await MomEmbedding.deleteMany({});
    if (req.query.retryEmpty === "1") await MomEmbedding.deleteMany({ chunkType: EMPTY });

    const done = await MomEmbedding.distinct("momId");
    const records = await MomFormat.find(rebuild ? {} : { _id: { $nin: done } })
      .select("state createdByEmail createdByName zone pc location district meetingDate createdAt " +
              "respondentName respondentDesignation respondentParty discussionPoints " +
              "stcActionables leaderActionables remarks")
      .limit(limit)
      .lean();

    let chunksWritten = 0;
    let emptyMeetings = 0;
    for (const rec of records) {
      const chunks = chunksFor(rec);
      for (const c of chunks) {
        c.embedding = await embed(c.text);
      }
      await MomEmbedding.deleteMany({ momId: rec._id });
      if (chunks.length) {
        await MomEmbedding.insertMany(chunks);
        chunksWritten += chunks.length;
      } else {
        // No embeddable text: record a marker so this meeting counts as
        // processed and is not fetched again on every run.
        await MomEmbedding.create({
          momId: rec._id, chunkType: EMPTY, text: "", embedding: [],
          state: clean(rec.state), createdByEmail: clean(rec.createdByEmail), model: MODEL_NAME,
        });
        emptyMeetings += 1;
      }
    }

    const remaining = await MomFormat.countDocuments({
      _id: { $nin: await MomEmbedding.distinct("momId") },
    });

    res.json({
      processedMeetings: records.length,
      chunksWritten,
      emptyMeetings,
      pending: remaining,
      message: remaining === 0
        ? "Index is complete."
        : `Indexed ${records.length} meetings. ${remaining} still pending — run again.`,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ------------------------------ retrieval ------------------------------ */

// Try Atlas Vector Search; fall back to in-memory cosine if no index exists.
async function retrieve(queryVector, scopeFilter, extraFilter, k) {
  const filter = { ...scopeFilter, ...extraFilter, chunkType: { $ne: EMPTY } };
  try {
    const results = await MomEmbedding.aggregate([
      {
        $vectorSearch: {
          index: process.env.MOM_VECTOR_INDEX || "mom_vector_index",
          path: "embedding",
          queryVector,
          numCandidates: Math.max(k * 15, 150),
          limit: k,
          filter,
        },
      },
      { $addFields: { score: { $meta: "vectorSearchScore" } } },
      { $project: { embedding: 0 } },
    ]);
    if (results && results.length) return { results, mode: "atlas" };
  } catch (e) {
    // index missing / tier without vector search -> fall through
  }

  // Fallback: score in memory. Bounded so a huge corpus cannot exhaust RAM.
  const cap = Number(process.env.MOM_RAG_SCAN_CAP || 20000);
  const docs = await MomEmbedding.find(filter)
    .select("text chunkType embedding createdByName createdByEmail meetingDate zone pc location district respondentName respondentDesignation actionable timeline momId")
    .limit(cap)
    .lean();
  const scored = docs
    .map((d) => ({ ...d, score: cosine(queryVector, d.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ embedding, ...rest }) => rest);
  return { results: scored, mode: "memory" };
}

/* ------------------------------- ask ------------------------------- */

router.post("/ask", async (req, res) => {
  try {
    const question = clean(req.body.question);
    if (question.length < 4) {
      return res.status(400).json({ error: "Please enter a question." });
    }
    const { zone, pc, ac, from, to } = req.body || {};
    const k = Math.min(Number(req.body.k) || 24, 60);

    // same permissions as the dashboard
    const scope = await punjabAwareStateScope(req);

    const extra = {};
    if (zone) extra.zone = zone;
    if (pc) extra.pc = pc;
    if (ac) extra.location = ac;
    if (from || to) {
      extra.meetingDate = {};
      if (from) extra.meetingDate.$gte = from;
      if (to) extra.meetingDate.$lte = to;
    }

    const qv = await embed(question);
    const { results, mode } = await retrieve(qv, scope, extra, k);

    if (!results.length) {
      return res.json({
        question, answer: "",
        empty: true,
        note: "No indexed meeting records match your filters. If the index was never built, an admin needs to run the indexer first.",
        sources: [], mode,
      });
    }

    // Build a compact, numbered context for the model.
    const context = results.map((r, i) =>
      `[${i + 1}] (${r.meetingDate || "no date"} · ${r.location || "?"} · ${r.createdByName || "unknown PCM"}` +
      `${r.respondentName ? ` · met ${r.respondentName}` : ""}) ${r.text}` +
      `${r.actionable ? ` | action: ${r.actionable}${r.timeline ? ` by ${r.timeline}` : ""}` : ""}`
    ).join("\n");

    let answer = "";
    if (aiProvider()) {
      const prompt =
`You are analysing field meeting records recorded by party coordinators (PCMs).

QUESTION: ${question}

RECORDS:
${context}

Answer the question using ONLY these records. Rules:
- Cite the record numbers you rely on, like [3] or [5][9].
- Name the PCM and constituency where it matters.
- If the records do not answer the question, say so plainly.
- Be specific and concise: 4-8 sentences, or short bullets if listing issues.
- Never invent names, numbers or events that are not above.`;
      answer = clean(await callModel(prompt) || "");
    }

    res.json({
      question,
      answer,
      aiEnabled: !!aiProvider(),
      mode, // "atlas" or "memory"
      sources: results.map((r, i) => ({
        n: i + 1,
        text: r.text,
        chunkType: r.chunkType,
        pcm: r.createdByName || r.createdByEmail || "Unknown",
        date: r.meetingDate || "",
        zone: r.zone || "", pc: r.pc || "", ac: r.location || "",
        respondent: r.respondentName || "",
        designation: r.respondentDesignation || "",
        actionable: r.actionable || "",
        timeline: r.timeline || "",
        score: typeof r.score === "number" ? Math.round(r.score * 1000) / 1000 : null,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
