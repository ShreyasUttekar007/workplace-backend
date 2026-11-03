/**
 * MoM summariser.
 *
 * TWO LAYERS:
 *  1. Local extraction (always runs): classifies every discussion point /
 *     actionable / remark into an issue category and pulls out themes,
 *     representative statements, actionables and PCM attribution. Free, instant,
 *     nothing leaves the server.
 *  2. LLM summarisation (runs when a key is configured): sends the condensed,
 *     de-duplicated text of each category to a free-tier model and asks for a
 *     tight executive summary. Falls back to layer 1 on any error or timeout.
 *
 * PROVIDERS (set ONE in the backend .env):
 *     GROQ_API_KEY=...     -> Groq     (recommended: fast, free)
 *     GEMINI_API_KEY=...   -> Google AI Studio
 * The model is AUTO-SELECTED from the provider's live model list (names get retired).
 * Optional overrides: GROQ_MODEL, GEMINI_MODEL, MOM_AI_DISABLED=1
 */

const CATEGORIES = [
  ["Caste Census & Booth Committees", [
    "caste census", "caste cenus", "booth committee", "booth commitee", "booth pradhan",
    "committee formation", "circle committee", "booth level", "voter list", "enumeration",
  ]],
  ["Welfare Schemes & Beneficiaries", [
    "pension", "ration", "housing", "scheme", "beneficiar", "subsidy", "welfare",
    "amma", "rythu", "insurance", "scholarship", "loan waiver", "aarogyasri",
  ]],
  ["Infrastructure & Civic Issues", [
    "road", "drainage", "water", "electricity", "power", "street light", "sanitation",
    "garbage", "bridge", "culvert", "irrigation", "canal", "bus", "transport", "civic",
  ]],
  ["Party Organisation & Cadre", [
    "cadre", "organisation", "organization", "party office", "committee meeting",
    "membership", "booth agent", "youth wing", "mandal", "incharge", "sangathan",
  ]],
  ["Leadership & Coordination", [
    "coordination", "cordination", "factional", "faction", "differences", "conflict",
    "infighting", "not appointed", "vacant", "leadership", "sidelined", "rift",
  ]],
  ["Opposition & Political Dynamics", [
    "opposition", "rival", "ysrcp", "tdp", "janasena", "bjp", "congress", "alliance",
    "defect", "joining", "candidate", "ticket", "survey", "anti incumbency",
  ]],
  ["Employment & Livelihood", [
    "employment", "job", "unemploy", "wage", "mgnrega", "farmer", "crop", "agricult",
    "fisher", "weaver", "labour", "labor", "industry", "msme",
  ]],
  ["Law & Order / Grievances", [
    "police", "law and order", "crime", "liquor", "encroach", "dispute", "land",
    "complaint", "grievance", "harass", "illegal",
  ]],
];

const STOP = new Set(`a an the and or but if then than that this these those of in on at to for with by from as is are was were be been being it its he she they we you i his her their our your not no yes do does did have has had will would shall should can could may might must about into over under again further once here there when where why how all any both each few more most other some such only own same so too very just don now also said say says meeting discussed discussion point points issue issues mr mrs shri smt sri village mandal district`.split(/\s+/));

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

function categorise(text) {
  const t = (text || "").toLowerCase();
  if (!t) return "Other Local Matters";
  for (const [name, keys] of CATEGORIES) {
    if (keys.some((k) => t.includes(k))) return name;
  }
  return "Other Local Matters";
}

function extractItems(rec) {
  const items = [];
  const push = (text, kind, extra = {}) => {
    const t = clean(text);
    if (t.length < 4) return;
    items.push({
      text: t, kind,
      pcm: clean(rec.createdByName) || clean(rec.createdByEmail) || "Unknown",
      date: clean(rec.meetingDate) ||
        (rec.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : ""),
      zone: clean(rec.zone), pc: clean(rec.pc), ac: clean(rec.location),
      respondent: clean(rec.respondentName), designation: clean(rec.respondentDesignation),
      ...extra,
    });
  };
  (rec.discussionPoints || []).forEach((d) =>
    push([clean(d.point), clean(d.details)].filter(Boolean).join(" — "), "discussion"));
  (rec.stcActionables || []).forEach((a) =>
    push(clean(a.issue), "stc_issue", { actionable: clean(a.actionable), timeline: clean(a.timeline) }));
  (rec.leaderActionables || []).forEach((a) =>
    push(clean(a.issue), "leader_issue", {
      actionable: clean(a.actionable), timeline: clean(a.timeline), partyLeader: clean(a.partyLeader),
    }));
  if (clean(rec.remarks)) push(rec.remarks, "remark");
  return items;
}

function themesOf(texts, limit = 8) {
  const uni = new Map(), bi = new Map();
  texts.forEach((t) => {
    const words = String(t).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w));
    words.forEach((w) => uni.set(w, (uni.get(w) || 0) + 1));
    for (let i = 0; i < words.length - 1; i++) {
      const b = `${words[i]} ${words[i + 1]}`;
      bi.set(b, (bi.get(b) || 0) + 1);
    }
  });
  const scored = [
    ...[...bi.entries()].filter(([, c]) => c > 1).map(([k, c]) => [k, c * 2.5]),
    ...[...uni.entries()].filter(([, c]) => c > 1).map(([k, c]) => [k, c]),
  ].sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [term, score] of scored) {
    if (out.length >= limit) break;
    if (out.some((o) => o.term.includes(term) || term.includes(o.term))) continue;
    out.push({ term, weight: Math.round(score) });
  }
  return out;
}

function representative(items, themes, limit = 5) {
  const terms = themes.map((t) => t.term);
  return items
    .map((it) => ({
      ...it,
      _score: terms.reduce((a, t) => a + (it.text.toLowerCase().includes(t) ? 1 : 0), 0)
        + Math.min(it.text.length / 160, 1.5),
    }))
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest);
}

// De-duplicate near-identical lines so the model sees signal, not repetition.
function dedupe(texts) {
  const seen = new Set(), out = [];
  for (const t of texts) {
    const key = t.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).slice(0, 12).join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/* ----------------------------- LLM providers ----------------------------- */

const AI_TIMEOUT_MS = Number(process.env.MOM_AI_TIMEOUT_MS || 30000);

function aiProvider() {
  if (process.env.MOM_AI_DISABLED === "1") return null;
  if (process.env.GROQ_API_KEY) return "groq";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

/* -------- model selection: discover what the provider actually offers -------- */
// Providers retire model names regularly, so nothing is hard-wired. A model set
// in .env always wins; otherwise the live model list is fetched, the best
// general-purpose chat model is chosen, and the choice is cached. If that model
// later disappears, the list is re-fetched and the next best is used.

const SYSTEM_PROMPT =
  "You are a political field-operations analyst. Write tight, factual, neutral briefings. " +
  "Never invent details that are not in the input.";

// Not chat models (speech, safety classifiers, embeddings, agents) - never pick these.
const NOT_CHAT = /whisper|guard|tts|playai|distil|embed|vision|audio|speech|compound|moderation|aqa|imagen|veo|learnlm/i;

const GROQ_PREFS = [/llama-3\.3-70b/i, /llama-4.*maverick/i, /llama-4/i, /gpt-oss-120b/i,
                    /70b/i, /qwen/i, /gpt-oss/i, /llama/i, /mixtral/i, /gemma/i];
const GEMINI_PREFS = [/gemini-[\d.]+-flash$/i, /gemini-[\d.]+-flash/i, /gemini-[\d.]+-pro/i, /gemini/i];

const modelCache = { groq: "", gemini: "" };
let lastPicked = "";

function rankModels(ids, prefs) {
  const usable = ids.filter((id) => id && !NOT_CHAT.test(id));
  for (const rx of prefs) {
    const hit = usable.filter((id) => rx.test(id)).sort().reverse(); // newest version first
    if (hit.length) return hit[0];
  }
  return usable[0] || "";
}

async function discoverModel(provider, exclude) {
  try {
    if (provider === "groq") {
      const r = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      });
      const j = await r.json().catch(() => ({}));
      const ids = (j.data || [])
        .filter((m) => m.active !== false)
        .map((m) => m.id)
        .filter((id) => id !== exclude);
      return rankModels(ids, GROQ_PREFS);
    }
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
    );
    const j = await r.json().catch(() => ({}));
    const ids = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((id) => id !== exclude);
    return rankModels(ids, GEMINI_PREFS);
  } catch (e) {
    return "";
  }
}

const looksLikeBadModel = (status, msg) =>
  status === 404 || (status === 400 && /model/i.test(msg || ""));

async function requestOnce(provider, model, prompt, signal) {
  if (provider === "groq") {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: prompt }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, msg: j?.error?.message || r.statusText,
             text: j?.choices?.[0]?.message?.content || "" };
  }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
      }),
    }
  );
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, msg: j?.error?.message || r.statusText,
           text: j?.candidates?.[0]?.content?.parts?.[0]?.text || "" };
}

async function callModel(prompt) {
  callModel.lastError = "";
  const provider = aiProvider();
  if (!provider || typeof fetch !== "function") return null;

  const label = provider === "groq" ? "Groq" : "Gemini";
  const envModel = provider === "groq" ? process.env.GROQ_MODEL : process.env.GEMINI_MODEL;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    // 1) .env choice  2) cached discovery  3) discover now
    let model = envModel || modelCache[provider] || (await discoverModel(provider));
    if (!model) {
      callModel.lastError = `${label}: could not find an available chat model for this API key.`;
      console.warn("[AI]", callModel.lastError);
      return null;
    }

    let res = await requestOnce(provider, model, prompt, ctrl.signal);

    // The model was retired or is not on this account -> pick another and retry once.
    if (!res.ok && looksLikeBadModel(res.status, res.msg)) {
      const next = await discoverModel(provider, model);
      if (next && next !== model) {
        console.warn(`[AI] ${label} model "${model}" unavailable - switching to "${next}"`);
        model = next;
        res = await requestOnce(provider, model, prompt, ctrl.signal);
      }
    }

    if (!res.ok) {
      callModel.lastError = `${label} ${res.status}: ${res.msg || "request failed"}` +
        (envModel ? ` (model "${envModel}" is set in .env - remove GROQ_MODEL/GEMINI_MODEL to auto-select)` : "");
      console.warn("[AI]", callModel.lastError);
      return null;
    }

    if (!envModel) modelCache[provider] = model;
    lastPicked = `${provider}:${model}`;
    return res.text || null;
  } catch (e) {
    callModel.lastError = e.name === "AbortError"
      ? `AI request timed out after ${AI_TIMEOUT_MS / 1000}s`
      : `AI request failed: ${e.message}`;
    console.warn("[AI]", callModel.lastError);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Which provider:model answered last (shown in the UI for transparency). */
function activeModel() {
  return lastPicked;
}

// Models sometimes wrap JSON in prose or fences - recover it defensively.
function parseJson(txt) {
  if (!txt) return null;
  const cleaned = String(txt).replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) { /* keep trying */ }
  const a = cleaned.indexOf("{"), b = cleaned.lastIndexOf("}");
  if (a > -1 && b > a) {
    try { return JSON.parse(cleaned.slice(a, b + 1)); } catch (e) { /* give up */ }
  }
  return null;
}

async function summariseCategoryWithAI(cat, items) {
  const lines = dedupe(items.map((i) =>
    i.actionable ? `${i.text} [action: ${i.actionable}${i.timeline ? `, by ${i.timeline}` : ""}]` : i.text
  )).slice(0, 60).join("\n- ");

  const prompt =
`Field meeting points recorded by party coordinators (PCMs) under the category "${cat}".

- ${lines}

Return ONLY valid JSON, no commentary, in this exact shape:
{
  "summary": "3-4 sentences summarising what the field is reporting in this category. Neutral, specific, no filler.",
  "keyIssues": ["4-6 short phrases naming the distinct problems raised"],
  "recommendedActions": ["2-4 concrete next steps implied by the points"],
  "severity": "High" | "Medium" | "Low"
}`;

  const parsed = parseJson(await callModel(prompt));
  if (!parsed || !parsed.summary) return null;
  return {
    summary: clean(parsed.summary),
    keyIssues: Array.isArray(parsed.keyIssues) ? parsed.keyIssues.map(clean).filter(Boolean).slice(0, 6) : [],
    recommendedActions: Array.isArray(parsed.recommendedActions)
      ? parsed.recommendedActions.map(clean).filter(Boolean).slice(0, 4) : [],
    severity: ["High", "Medium", "Low"].includes(parsed.severity) ? parsed.severity : "Medium",
  };
}

async function executiveSummary(categories, totals, filters) {
  const digest = categories
    .map((c) => `${c.category} (${c.count} points): ${c.aiSummary || c.narrative}`)
    .join("\n");
  const scope = [filters.zone, filters.pc, filters.ac].filter(Boolean).join(" / ") || "all mapped areas";
  const prompt =
`Field meeting intelligence for ${scope}: ${totals.meetings} meetings, ${totals.points} points, ${totals.pcms} coordinators.

${digest}

Write a 4-5 sentence EXECUTIVE SUMMARY for senior leadership: what dominates the field right now, what is improving or deteriorating, and what needs attention first. Plain prose, no headings, no bullet points, no invented facts.`;
  const txt = await callModel(prompt);
  return txt ? clean(txt) : "";
}

/* ------------------------------ assembly ------------------------------ */

function buildCategorySummary(name, items) {
  const texts = items.map((i) => i.text);
  const themes = themesOf(texts);
  const actionables = items.filter((i) => i.actionable).map((i) => ({
    issue: i.text, actionable: i.actionable, timeline: i.timeline || "",
    partyLeader: i.partyLeader || "", pcm: i.pcm, ac: i.ac,
  }));
  const byPcm = {};
  items.forEach((i) => { byPcm[i.pcm] = (byPcm[i.pcm] || 0) + 1; });
  const acs = [...new Set(items.map((i) => i.ac).filter(Boolean))];
  const topThemes = themes.slice(0, 4).map((t) => t.term).join(", ");

  return {
    category: name,
    count: items.length,
    narrative:
      `${items.length} point${items.length === 1 ? "" : "s"} across ` +
      `${acs.length || 1} assembly constituenc${acs.length === 1 ? "y" : "ies"}` +
      `${topThemes ? `, centring on ${topThemes}` : ""}. ` +
      `${actionables.length} actionable${actionables.length === 1 ? "" : "s"} raised.`,
    themes,
    highlights: representative(items, themes),
    actionables: actionables.slice(0, 12),
    byPcm: Object.entries(byPcm).map(([pcm, count]) => ({ pcm, count })).sort((a, b) => b.count - a.count),
    acs,
    _items: items,
  };
}

function summariseLocal(records) {
  const all = [];
  records.forEach((r) => all.push(...extractItems(r)));
  const buckets = {};
  all.forEach((it) => { const c = categorise(it.text); (buckets[c] = buckets[c] || []).push(it); });

  const categories = Object.entries(buckets)
    .map(([name, items]) => buildCategorySummary(name, items))
    .sort((a, b) => b.count - a.count);

  const pcmTotals = {};
  records.forEach((r) => {
    const n = clean(r.createdByName) || clean(r.createdByEmail) || "Unknown";
    pcmTotals[n] = (pcmTotals[n] || 0) + 1;
  });

  return {
    totals: {
      meetings: records.length, points: all.length, categories: categories.length,
      actionables: all.filter((i) => i.actionable).length, pcms: Object.keys(pcmTotals).length,
    },
    pcmTotals: Object.entries(pcmTotals).map(([pcm, meetings]) => ({ pcm, meetings }))
      .sort((a, b) => b.meetings - a.meetings),
    categories,
  };
}

async function summarise(records, filters = {}) {
  const base = summariseLocal(records);
  const provider = aiProvider();
  base.ai = { enabled: !!provider, provider: provider || "none", ok: false };

  if (!provider || !base.categories.length) {
    base.categories.forEach((c) => { delete c._items; });
    return base;
  }

  let any = false;
  for (const cat of base.categories) {
    const ai = await summariseCategoryWithAI(cat.category, cat._items);
    if (ai) {
      cat.aiSummary = ai.summary;
      cat.keyIssues = ai.keyIssues;
      cat.recommendedActions = ai.recommendedActions;
      cat.severity = ai.severity;
      any = true;
    }
    delete cat._items;
  }

  if (any) {
    base.executiveSummary = await executiveSummary(base.categories, base.totals, filters);
  }
  base.ai.ok = any;
  return base;
}

module.exports = { summarise, categorise, aiProvider, callModel, activeModel };
