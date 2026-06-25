const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authenticateUser");
const { syncEmployeesFromSheet } = require("../utils/sheetSync");

router.use(authenticateUser);

// Only admins may trigger a manual sync.
function adminOnly(req, res, next) {
  const roles = (req.user && req.user.roles) || [];
  if (!roles.includes("admin")) {
    return res.status(403).json({ error: "Admins only" });
  }
  next();
}

// Preview what would change without writing anything.
router.get("/dry-run", adminOnly, async (req, res) => {
  try {
    const result = await syncEmployeesFromSheet({ dryRun: true });
    res.status(200).json(result);
  } catch (e) {
    console.error("Sheet dry-run error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Run the real sync now.
router.post("/run", adminOnly, async (req, res) => {
  try {
    const result = await syncEmployeesFromSheet({ dryRun: false });
    res.status(200).json(result);
  } catch (e) {
    console.error("Sheet sync error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
