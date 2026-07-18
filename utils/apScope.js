// AP role -> data scope. Mirrors punjabGeo.punjabScope but for Andhra Pradesh's
// Zone / PC / AC / District hierarchy. Isolated so Maharashtra is unaffected.
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

// mode "all": admin/mod/state -> everything in AP
// mode "geo": Zonal/State Lead (zones) or PCM (pcs/acs) -> only mapped geography
// mode "own": no mapping yet -> only own records
function apScope(roles = []) {
  const r = (Array.isArray(roles) ? roles : []).map(String);
  const low = r.map((x) => x.toLowerCase());
  if (low.includes("admin") || low.includes("mod") || low.includes("state")) {
    return { mode: "all" };
  }
  const zones = r.filter((x) => Z.has(x));
  const pcs = r.filter((x) => P.has(x));
  const acs = r.filter((x) => A.has(x));
  const districts = r.filter((x) => D.has(x));
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
