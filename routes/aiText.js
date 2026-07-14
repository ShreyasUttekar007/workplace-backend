const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authenticateUser");
const multer = require("multer");
require("dotenv").config();

router.use(authenticateUser);

// Audio upload for speech-to-text (in-memory; free tier caps files at 25 MB).
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Map the UI's BCP-47 codes to Whisper's 2-letter language hints.
const WHISPER_LANG = {
  "en-IN": "en",
  "hi-IN": "hi",
  "te-IN": "te",
  "pa-IN": "pa",
  "mr-IN": "mr",
  "bn-IN": "bn",
  "ta-IN": "ta",
};

const firstWords = (t, n) =>
  (t || "").trim().split(/\s+/).slice(0, n).join(" ");

function parseJsonLoose(s) {
  if (!s) return null;
  let str = s.trim();
  // strip code fences if present
  str = str.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // grab the first {...} block
  const m = str.match(/\{[\s\S]*\}/);
  if (m) str = m[0];
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

async function callGroq(apiKey, model, system, user, maxTokens) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens || 400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Groq ${r.status}: ${errText}`);
  }
  const data = await r.json();
  return (
    (data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content) ||
    ""
  ).trim();
}

/**
 * POST /api/ai/clean-text
 * body: { text, mode: "split" | "summary", context? }
 *
 * mode "split"   -> returns { point, details }  (short headline + crisp summary)
 * mode "summary" -> returns { text }            (crisp single summary)
 *
 * Falls back to raw text if GROQ_API_KEY is missing or the call fails.
 */
router.post("/clean-text", async (req, res) => {
  const raw = (req.body && req.body.text ? String(req.body.text) : "").trim();
  const mode = (req.body && req.body.mode) || "summary";
  const context = (req.body && req.body.context) || "";

  if (!raw) return res.status(400).json({ error: "No text provided" });

  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  // Graceful fallback when AI is not configured.
  if (!apiKey) {
    if (mode === "split") {
      return res.json({ point: firstWords(raw, 12), details: raw, ai: false });
    }
    return res.json({ text: raw, ai: false });
  }

  try {
    if (mode === "split") {
      const labelHint =
        context === "stc_actionable" || context === "leader_actionable"
          ? "The 'point' is the core ISSUE/action point; 'details' is the concrete actionable."
          : "The 'point' is the key issue/feedback/demand/suggestion; 'details' is the supporting explanation.";

      const system =
        "You convert dictated political field-meeting notes (often rough speech-to-text, " +
        "sometimes mixed Indian languages) into a CRISP structured summary. " +
        "Return ONLY valid minified JSON of the form {\"point\":\"...\",\"details\":\"...\"}. " +
        labelHint +
        " Rules: 'point' = a short headline, MAXIMUM 12 words, no ending period. " +
        "'details' = a crisp professional summary in AT MOST 2 short sentences. " +
        "Fix grammar and speech-to-text errors. Preserve all facts, names, places, numbers and dates exactly. " +
        "Never invent information. Output JSON only — no markdown, no extra text.";

      const out = await callGroq(apiKey, model, system, raw, 400);
      const parsed = parseJsonLoose(out);
      if (parsed && (parsed.point || parsed.details)) {
        return res.json({
          point: (parsed.point || "").trim(),
          details: (parsed.details || "").trim(),
          ai: true,
        });
      }
      // parsing failed — degrade gracefully
      return res.json({ point: firstWords(raw, 12), details: out || raw, ai: false });
    }

    // mode === "summary"
    const system =
      "You summarise dictated meeting notes (rough speech-to-text) into a CRISP, professional note. " +
      "Write AT MOST 2 short sentences. Fix grammar and obvious speech-to-text errors. " +
      "Preserve all facts, names, places, numbers and dates exactly. Never invent anything. " +
      "Reply with ONLY the summary text — no preamble, no quotes.";
    const out = await callGroq(apiKey, model, system, raw, 300);
    return res.json({ text: out || raw, ai: !!out });
  } catch (e) {
    console.error("clean-text error:", e.message);
    if (mode === "split") {
      return res.json({ point: firstWords(raw, 12), details: raw, ai: false });
    }
    return res.json({ text: raw, ai: false });
  }
});

/**
 * POST /api/ai/transcribe   (multipart/form-data)
 * fields: audio (file), lang? (BCP-47 hint, e.g. "pa-IN")
 * returns: { text }
 *
 * Uses Groq Whisper Large v3 (free tier). Language is passed as a hint only;
 * Whisper still auto-handles code-mixed speech. Falls back with a clear error
 * if the key is missing or Groq rejects the audio.
 */
router.post("/transcribe", audioUpload.single("audio"), async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Speech-to-text is not configured." });
  }
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ error: "No audio provided." });
  }

  const model = process.env.GROQ_STT_MODEL || "whisper-large-v3";
  const rawLang = (req.body && req.body.lang) || "";
  const lang = WHISPER_LANG[rawLang] || (rawLang ? rawLang.slice(0, 2) : "");

  try {
    const fd = new FormData();
    fd.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype || "audio/webm" }),
      req.file.originalname || "audio.webm"
    );
    fd.append("model", model);
    fd.append("response_format", "json");
    fd.append("temperature", "0");
    if (lang) fd.append("language", lang);

    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("transcribe error:", r.status, errText);
      return res.status(502).json({ error: "Transcription failed." });
    }

    const data = await r.json();
    return res.json({ text: data && data.text ? String(data.text).trim() : "" });
  } catch (e) {
    console.error("transcribe exception:", e.message);
    return res.status(500).json({ error: "Transcription error." });
  }
});

module.exports = router;
