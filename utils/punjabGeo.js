// utils/punjabGeo.js
// -----------------------------------------------------------------------------
// Single source of truth for the Punjab Region > District > AC geography.
// Loaded once from data/punjabGeography.json. Used by:
//   - routes/punjab.js         (serves the cascading dropdowns)
//   - models/MomFormat.js      (fills zone=region / district for Punjab records)
//   - models/NewMomModel.js    (same, for the legacy Leader-Meeting flow)
// Mirrors how the AP flow derives zone/district/pc from the booth collection,
// but for Punjab the source is this static file (no booth collection needed).
// -----------------------------------------------------------------------------

const path = require("path");
const fs = require("fs");

let GEO = { state: "Punjab", regions: {} };
try {
  GEO = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "punjabGeography.json"), "utf8")
  );
} catch (e) {
  console.error("[punjabGeo] could not load data/punjabGeography.json:", e.message);
}

// Build a fast AC -> { region, district, ac_no } index (case-insensitive).
const AC_INDEX = {};
for (const region of Object.values(GEO.regions || {})) {
  for (const [district, list] of Object.entries(region.districts || {})) {
    for (const ac of list) {
      AC_INDEX[String(ac.ac_name).trim().toLowerCase()] = {
        region: region.region,
        district,
        ac_no: ac.ac_no,
        ac_name: ac.ac_name,
      };
    }
  }
}

// Look up the region + district for a given AC (constituency) name.
function lookupAc(acName) {
  if (!acName) return null;
  return AC_INDEX[String(acName).trim().toLowerCase()] || null;
}

// Build email -> reporting-manager-name map from the Punjab seed.
let MANAGER_BY_EMAIL = {};
try {
  const seed = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "punjabUsersSeed.json"), "utf8")
  );
  const nameByEmail = {};
  seed.forEach((u) => {
    if (u.email) nameByEmail[u.email.toLowerCase()] = u.name;
  });
  seed.forEach((u) => {
    if (u.role === "acm" && Array.isArray(u.reportsTo) && u.reportsTo.length) {
      const mgrEmail = u.reportsTo[0].toLowerCase();
      MANAGER_BY_EMAIL[u.email.toLowerCase()] = nameByEmail[mgrEmail] || "";
    }
  });
} catch (e) {
  console.error("[punjabGeo] could not build manager map:", e.message);
}

// Reporting manager name for a recorder's email (Punjab). "" if unknown.
function managerFor(email) {
  if (!email) return "";
  return MANAGER_BY_EMAIL[String(email).trim().toLowerCase()] || "";
}

// The nested tree for the frontend cascading dropdowns.
function tree() {
  return GEO;
}

// Flat AC list.
function acList() {
  const acs = [];
  for (const region of Object.values(GEO.regions || {})) {
    for (const [district, list] of Object.entries(region.districts || {})) {
      for (const ac of list) {
        acs.push({ region: region.region, district, ac_no: ac.ac_no, ac_name: ac.ac_name });
      }
    }
  }
  return acs;
}

module.exports = { tree, acList, lookupAc, managerFor, GEO };
