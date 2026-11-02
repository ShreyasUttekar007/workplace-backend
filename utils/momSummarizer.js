/**
 * MoM summariser — runs entirely on your own server.
 *
 * No external AI service, no API key, no cost, and no meeting content ever
 * leaves your infrastructure. It classifies every discussion point / actionable
 * into an issue category, then produces an extractive summary per category:
 * recurring themes (weighted keywords), the most representative statements, the
 * actionables raised, and who recorded what.
 *
 * OPTIONAL: if you later set GEMINI_API_KEY in the backend .env, each category's
 * extractive digest is sent for a short narrative rewrite. It is OFF unless that
 * key exists, and it falls back silently to the local summary on any failure.
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

const STOP = new Set(`a an the and or but if then than that this these those of in on at to for with by from as is are was were be been being it its it's he she they we you i his her their our your not no yes do does did have has had will would shall should can could may might must about into over under again further once here there when where why how all any both each few more most other some such only own same so too very s t just don now also said say says meeting discussed discussion point points issue issues mr mrs shri smt sri village mandal district`.split(/\s+/));

const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

function categorise(text) {
  const t = (text || "").toLowerCase();
  if (!t) return "Other Local Matters";
  for (const [name, keys] of CATEGORIES) {
    if (keys.some((k) => t.includes(k))) return name;
  }
  return "Other Local Matters";
}

// Pull every piece of substantive text out of one meeting record.
function extractItems(rec) {
  const items = [];
  const push = (text, kind, extra = {}) => {
    const t = clean(text);
    if (t.length < 4) return;
    items.push({
      text: t,
      kind,
      pcm: clean(rec.createdByName) || clean(rec.createdByEmail) || "Unknown",
      pcmEmail: clean(rec.createdByEmail),
      date: clean(rec.meetingDate) || (rec.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : ""),
      zone: clean(rec.zone),
      pc: clean(rec.pc),
      ac: clean(rec.location),
      district: clean(rec.district),
      respondent: clean(rec.respondentName),
      designation: clean(rec.respondentDesignation),
      ...extra,
    });
  };

  (rec.discussionPoints || []).forEach((d) => {
    push([clean(d.point), clean(d.details)].filter(Boolean).join(" — "), "discussion");
  });
  (rec.stcActionables || []).forEach((a) => {
    push(clean(a.issue), "stc_issue", { actionable: clean(a.actionable), timeline: clean(a.timeline) });
  });
  (rec.leaderActionables || []).forEach((a) => {
    push(clean(a.issue), "leader_issue", {
      actionable: clean(a.actionable),
      timeline: clean(a.timeline),
      partyLeader: clean(a.partyLeader),
    });
  });
  if (clean(rec.remarks)) push(rec.remarks, "remark");
  return items;
}

// Weighted keyword extraction (term frequency, stop-worded, bigrams favoured).
function themesOf(texts, limit = 8) {
  const uni = new Map();
  const bi = new Map();
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
    // skip a unigram already covered by a chosen bigram
    if (out.some((o) => o.term.includes(term) || term.includes(o.term))) continue;
    out.push({ term, weight: Math.round(score) });
  }
  return out;
}

// Pick the statements that best represent the group (highest theme coverage).
function representative(items, themes, limit = 5) {
  const terms = themes.map((t) => t.term);
  return items
    .map((it) => {
      const low = it.text.toLowerCase();
      const score = terms.reduce((a, t) => a + (low.includes(t) ? 1 : 0), 0)
        + Math.min(it.text.length / 160, 1.5);
      return { ...it, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score, ...rest }) => rest);
}

function buildCategorySummary(name, items) {
  const texts = items.map((i) => i.text);
  const themes = themesOf(texts);
  const actionables = items
    .filter((i) => i.actionable)
    .map((i) => ({
      issue: i.text, actionable: i.actionable, timeline: i.timeline || "",
      partyLeader: i.partyLeader || "", pcm: i.pcm, ac: i.ac,
    }));

  const byPcm = {};
  items.forEach((i) => { byPcm[i.pcm] = (byPcm[i.pcm] || 0) + 1; });

  const acs = [...new Set(items.map((i) => i.ac).filter(Boolean))];
  const topThemes = themes.slice(0, 4).map((t) => t.term).join(", ");

  // A plain-language digest assembled from the aggregates.
  const narrative =
    `${items.length} point${items.length === 1 ? "" : "s"} recorded across ` +
    `${acs.length || 1} assembly constituenc${acs.length === 1 ? "y" : "ies"}` +
    `${topThemes ? `, centring on ${topThemes}` : ""}. ` +
    `${actionables.length} actionable${actionables.length === 1 ? "" : "s"} raised. ` +
    `Reported by ${Object.keys(byPcm).length} PCM${Object.keys(byPcm).length === 1 ? "" : "s"}.`;

  return {
    category: name,
    count: items.length,
    narrative,
    themes,
    highlights: representative(items, themes),
    actionables: actionables.slice(0, 12),
    byPcm: Object.entries(byPcm).map(([pcm, count]) => ({ pcm, count }))
      .sort((a, b) => b.count - a.count),
    acs,
  };
}

function summarise(records) {
  const all = [];
  records.forEach((r) => all.push(...extractItems(r)));

  const buckets = {};
  all.forEach((it) => {
    const c = categorise(it.text);
    (buckets[c] = buckets[c] || []).push(it);
  });

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
      meetings: records.length,
      points: all.length,
      categories: categories.length,
      actionables: all.filter((i) => i.actionable).length,
      pcms: Object.keys(pcmTotals).length,
    },
    pcmTotals: Object.entries(pcmTotals).map(([pcm, meetings]) => ({ pcm, meetings }))
      .sort((a, b) => b.meetings - a.meetings),
    categories,
  };
}

/**
 * Optional narrative polish via Gemini's free tier. Enabled ONLY when
 * GEMINI_API_KEY is set; otherwise the local summary is returned untouched.
 */
async function polishWithLLM(summary) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || typeof fetch !== "function") return summary;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  try {
    for (const cat of summary.categories) {
      const bullets = cat.highlights.map((h) => `- ${h.text}`).join("\n").slice(0, 4000);
      const prompt =
        `Summarise these field-meeting points under "${cat.category}" in 2-3 neutral ` +
        `sentences for a political operations report. No preamble, no bullet points.\n\n${bullets}`;
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      const j = await r.json();
      const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (txt) cat.narrative = clean(txt);
    }
    summary.aiPolished = true;
  } catch (e) {
    summary.aiPolished = false;
  }
  return summary;
}

module.exports = { summarise, polishWithLLM, categorise };
