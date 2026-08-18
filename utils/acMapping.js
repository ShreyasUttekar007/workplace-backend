const path = require("path");
const fs = require("fs");

let MAP = [];
try {
  MAP = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "acMapping.json"), "utf8")
  );
} catch (e) {
  console.error("[acMapping] could not load data/acMapping.json:", e.message);
}

const byEmail = {};
const byAcNo = {};
MAP.forEach((m) => {
  if (m.employeeEmail) byEmail[String(m.employeeEmail).toLowerCase()] = m;
  if (m.acNo != null) byAcNo[Number(m.acNo)] = m;
});

function acForEmail(email) {
  if (!email) return null;
  return byEmail[String(email).toLowerCase()] || null;
}
function infoForAcNo(acNo) {
  return byAcNo[Number(acNo)] || null;
}

module.exports = { acForEmail, infoForAcNo, all: () => MAP };
