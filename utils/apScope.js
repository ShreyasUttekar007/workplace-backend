// AP role -> data scope. Role-type aware so a PCM is never widened to a whole
// zone just because a Zone was picked while assigning them in the UI.
//
//  - admin / mod / state        -> all AP
//  - Zonal / State Lead         -> their Zone(s) (plus any explicit PC/AC, e.g.
//                                  the Araku split where two leads share a zone)
//  - PCM                        -> their PC(s)/AC(s) ONLY (zone is ignored;
//                                  it was only used to narrow the UI dropdowns)
//  - any geo role, no type      -> union of assigned geography
//  - no mapping                 -> own records only
const {
  zoneRolesAp,
  parliamentaryConstituencyRolesAp,
  assemblyConstituenciesAp,
  districtRolesAp,
} = require("../models/roles");

const Z = new Set(zoneRolesAp);
const P = new Set(parliamentaryConstituencyRolesAp);
const A = new Set(assemblyConstituenciesAp);
const D = new Set(districtRolesAp);

function apScope(roles = []) {
  const r = (Array.isArray(roles) ? roles : []).map(String);
  const low = r.map((x) => x.toLowerCase());

  if (low.includes("admin") || low.includes("mod") || low.includes("state")) {
    return { mode: "all" };
  }

  const isZonal = r.includes("Zonal") || r.includes("State Lead");
  const isPcm = r.includes("PCM");

  const zones = r.filter((x) => Z.has(x));
  const pcs = r.filter((x) => P.has(x));
  const acs = r.filter((x) => A.has(x));
  const districts = r.filter((x) => D.has(x));

  // PCM (and NOT a zonal/state-lead): restrict to their PC(s)/AC(s), never the
  // zone. This is what stops one PCM seeing another PCM's data in the same zone.
  if (isPcm && !isZonal) {
    if (pcs.length || acs.length || districts.length) {
      return { mode: "geo", zones: [], pcs, acs, districts };
    }
    return { mode: "own" };
  }

  // Zonal / State Lead / other geo assignments: union of what they hold.
  if (zones.length || pcs.length || acs.length || districts.length) {
    return { mode: "geo", zones, pcs, acs, districts };
  }
  return { mode: "own" };
}

// Build a Mongo $or filter using the caller's field names.
// fields: { zone, pc, ac, district } -> record field name for each bucket.
function apOrFilter(sc, fields) {
  const or = [];
  if (sc.zones && sc.zones.length && fields.zone) or.push({ [fields.zone]: { $in: sc.zones } });
  if (sc.pcs && sc.pcs.length && fields.pc) or.push({ [fields.pc]: { $in: sc.pcs } });
  if (sc.acs && sc.acs.length && fields.ac) or.push({ [fields.ac]: { $in: sc.acs } });
  if (sc.districts && sc.districts.length && fields.district)
    or.push({ [fields.district]: { $in: sc.districts } });
  return or.length ? { $or: or } : null;
}

module.exports = { apScope, apOrFilter };
