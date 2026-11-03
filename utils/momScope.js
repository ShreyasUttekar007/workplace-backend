/**
 * Shared meeting-visibility scope.
 *
 * Extracted so BOTH the dashboard/meta-summary routes and the RAG retrieval use
 * the exact same permission rules. Duplicating this logic once caused a real
 * access bug, so it now lives in one place only.
 */
const User = require("../models/User");
const punjabGeo = require("./punjabGeo");
const { apScope, apOrFilter } = require("./apScope");

// Emails of everyone who reports to this user (direct reports, primary or
// secondary reporting manager). Used so a reporting manager can see the meetings
// recorded by their team, not just their own.
async function reporteeEmails(email) {
  const me = String(email || "").trim();
  if (!me) return [];
  try {
    const rx = new RegExp(`^${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const team = await User.find(
      { $or: [{ reportingManagerEmail: rx }, { secondaryReportingManagerEmail: rx }] },
      "email"
    ).lean();
    return team.map((u) => (u.email || "").trim()).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Build the "own records" filter, widened to include the caller's reportees.
async function ownOrTeamFilter(email) {
  const team = await reporteeEmails(email);
  if (!team.length) return { createdByEmail: email };
  // case-insensitive match on the caller + each reportee
  const all = [email, ...team];
  return {
    createdByEmail: {
      $in: all.map((e) => new RegExp(`^${String(e).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")),
    },
  };
}

async function punjabAwareStateScope(req) {
  const userState = (req.user && req.user.location) || "";
  const roles = (req.user && req.user.roles) || [];
  const email = (req.user && req.user.email) || "__none__";

  // A PCM sees their OWN records — plus, if they are a reporting manager, the
  // records created by their reportees. Zonal / State Lead / admin keep their
  // wider geographic view.
  const roleStrs = (Array.isArray(roles) ? roles : []).map(String);
  const isPcm =
    roleStrs.includes("PCM") &&
    !roleStrs.includes("Zonal") &&
    !roleStrs.includes("State Lead");

  if (userState === "Punjab") {
    if (isPcm) return { state: "Punjab", ...(await ownOrTeamFilter(email)) };
    const sc = punjabGeo.punjabScope(roles);
    if (sc.mode === "all") return { state: "Punjab" };
    if (sc.mode === "geo") return { state: "Punjab", ...sc.filter };
    return { state: "Punjab", ...(await ownOrTeamFilter(email)) };
  }

  // Andhra Pradesh: Zonal -> zone, PCM -> own + team, State Lead -> zones,
  // admin/mod/state -> all AP, unmapped -> own + team. (MoM AC field = location.)
  if (userState === "Andhra Pradesh") {
    if (isPcm) return { state: "Andhra Pradesh", ...(await ownOrTeamFilter(email)) };
    const sc = apScope(roles);
    if (sc.mode === "all") return { state: "Andhra Pradesh" };
    if (sc.mode === "geo") {
      const f = apOrFilter(sc, { zone: "zone", pc: "pc", ac: "location", district: "district" });
      return { state: "Andhra Pradesh", ...(f || {}) };
    }
    return { state: "Andhra Pradesh", ...(await ownOrTeamFilter(email)) };
  }

  return { state: { $ne: "Punjab" } };
}


module.exports = { punjabAwareStateScope, reporteeEmails, ownOrTeamFilter, teamOnlyCondition, geoOrTeam };
