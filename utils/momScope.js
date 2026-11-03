/**
 * Shared meeting-visibility scope.
 *
 * Single source of truth for who can see which meeting records. Used by the
 * dashboard, the meta-summary and the RAG retrieval, so the rules can never
 * drift apart (duplicating them previously caused a real access bug).
 */
const User = require("../models/User");
const punjabGeo = require("./punjabGeo");
const { apScope, apOrFilter } = require("./apScope");

const esc = (e) => String(e).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rxExact = (e) => new RegExp(`^${esc(e)}$`, "i");

/**
 * Emails of everyone who reports to this user (primary or secondary reporting
 * manager), so a manager sees the meetings recorded by their team.
 */
async function reporteeEmails(email) {
  const me = String(email || "").trim();
  if (!me) return [];
  try {
    const rx = rxExact(me);
    const team = await User.find(
      { $or: [{ reportingManagerEmail: rx }, { secondaryReportingManagerEmail: rx }] },
      "email"
    ).lean();
    return team.map((u) => (u.email || "").trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** Just the reportee condition, or null when the caller manages nobody. */
async function teamOnlyCondition(email) {
  const team = await reporteeEmails(email);
  if (!team.length) return null;
  return { createdByEmail: { $in: team.map(rxExact) } };
}

/** "Own records" widened to include the caller's reportees. */
async function ownOrTeamFilter(email) {
  const team = await reporteeEmails(email);
  if (!team.length) return { createdByEmail: email };
  return { createdByEmail: { $in: [email, ...team].map(rxExact) } };
}

/**
 * Geography OR team: a manager sees everything in their mapped area PLUS
 * anything their reportees recorded, even outside that area.
 */
function geoOrTeam(stateFilter, geoFilter, teamCond) {
  if (!teamCond) return { ...stateFilter, ...(geoFilter || {}) };
  return { ...stateFilter, $or: [{ ...(geoFilter || {}) }, teamCond] };
}

async function punjabAwareStateScope(req) {
  const userState = (req.user && req.user.location) || "";
  const roles = (req.user && req.user.roles) || [];
  const email = (req.user && req.user.email) || "__none__";

  // A PCM sees their OWN records plus their reportees' - never other PCMs'
  // records in the same district. Zonal / State Lead / admin keep wider views.
  const roleStrs = (Array.isArray(roles) ? roles : []).map(String);
  const isPcm =
    roleStrs.includes("PCM") &&
    !roleStrs.includes("Zonal") &&
    !roleStrs.includes("State Lead");

  if (userState === "Punjab") {
    if (isPcm) return { state: "Punjab", ...(await ownOrTeamFilter(email)) };
    const sc = punjabGeo.punjabScope(roles);
    if (sc.mode === "all") return { state: "Punjab" };
    if (sc.mode === "geo") {
      return geoOrTeam({ state: "Punjab" }, sc.filter, await teamOnlyCondition(email));
    }
    return { state: "Punjab", ...(await ownOrTeamFilter(email)) };
  }

  if (userState === "Andhra Pradesh") {
    if (isPcm) return { state: "Andhra Pradesh", ...(await ownOrTeamFilter(email)) };
    const sc = apScope(roles);
    if (sc.mode === "all") return { state: "Andhra Pradesh" };
    if (sc.mode === "geo") {
      const f = apOrFilter(sc, { zone: "zone", pc: "pc", ac: "location", district: "district" });
      return geoOrTeam({ state: "Andhra Pradesh" }, f, await teamOnlyCondition(email));
    }
    return { state: "Andhra Pradesh", ...(await ownOrTeamFilter(email)) };
  }

  return { state: { $ne: "Punjab" } };
}

module.exports = {
  punjabAwareStateScope,
  reporteeEmails,
  ownOrTeamFilter,
  teamOnlyCondition,
  geoOrTeam,
};
