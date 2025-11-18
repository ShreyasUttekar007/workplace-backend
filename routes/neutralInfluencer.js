const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const NeutralInfluencer = require("../models/NeutralInfluencer");
const User = require("../models/User");
const authenticateUser = require("../middleware/authenticateUser");

const allowedStates = [
  "Maharashtra",
  "Andhra Pradesh",
  "Bengal",
  "Uttar Pradesh",
];

// case-insensitive equality
const ciEq = (val) => ({
  $regex: `^${String(val).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
  $options: "i",
});

// parse dd-mm-yyyy or yyyy-mm-dd
function parseLooseDate(d) {
  if (!d || typeof d !== "string") return null;
  const s = d.trim();
  let day, mon, yr;
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) [day, mon, yr] = s.split("-").map(Number);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s))
    [yr, mon, day] = s.split("-").map(Number);
  else {
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(yr, mon - 1, day, 0, 0, 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
}

router.use(authenticateUser);

/* ===================== CREATE ===================== */
router.post("/add", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.userId)
      return res
        .status(400)
        .json({ success: false, message: "userId is required" });
    if (!req.user)
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized - User not found" });
    if (
      String(body.userId) !== String(req.user._id) &&
      !req.user.roles?.includes("admin")
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden - Unauthorized user" });
    }

    // mirror Social Listening: set state from user
    const state = req.user.location || body.state || "";
    const doc = await NeutralInfluencer.create({ ...body, state });
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    console.error("NeutralInfluencer add error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ===================== DASHBOARD ===================== */
router.get("/dashboard/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const me = await User.findById(req.user?._id).select("roles location");
    if (!me)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    const roles = Array.isArray(me.roles) ? me.roles : [];
    const isAdmin = roles.includes("admin");

    const match = {};
    if (allowedStates.includes(me.location)) match.state = me.location;

    // non-admins only their own docs
    if (!isAdmin && String(userId) !== String(req.user._id)) {
      return res
        .status(403)
        .json({ success: false, message: "Forbidden - Unauthorized user" });
    }
    if (!isAdmin) match.userId = new mongoose.Types.ObjectId(userId);

    // filters
    const {
      zone = "",
      district = "",
      constituency = "",
      dateFrom = "",
      dateTo = "",
      page = "1",
      limit = "100",
      sort = "-createdAt",
    } = req.query;

    if (zone) match.zone = ciEq(zone);
    if (district) match.district = ciEq(district);
    if (constituency) match.constituency = ciEq(constituency);

    const f = parseLooseDate(dateFrom);
    const t = parseLooseDate(dateTo);
    if (f || t) {
      match.createdAt = {};
      if (f) match.createdAt.$gte = f;
      if (t) {
        const end = new Date(t);
        end.setHours(23, 59, 59, 999);
        match.createdAt.$lte = end;
      }
    }

    // pagination
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const lm = Math.max(1, parseInt(limit, 10) || 100);
    const skip = (pg - 1) * lm;

    // data page + total
    const [items, total] = await Promise.all([
      NeutralInfluencer.find(match).sort(sort).skip(skip).limit(lm).lean(),
      NeutralInfluencer.countDocuments(match),
    ]);
    const pages = Math.max(1, Math.ceil(total / lm));

    // options (scoped only by state)
    const baseForOptions = {};
    if (match.state) baseForOptions.state = match.state;

    const [zones, districts, constituencies] = await Promise.all([
      NeutralInfluencer.distinct("zone", baseForOptions).then((xs) =>
        xs.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
      ),
      NeutralInfluencer.distinct("district", baseForOptions).then((xs) =>
        xs.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
      ),
      NeutralInfluencer.distinct("constituency", baseForOptions).then((xs) =>
        xs.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))
      ),
    ]);

    const roleAgg = await NeutralInfluencer.aggregate([
      { $match: match },

      // Normalize professionRole safely
      {
        $addFields: {
          _roleRaw: { $ifNull: ["$professionRole", ""] },
        },
      },
      {
        $addFields: {
          _roleLc: {
            $toLower: { $trim: { input: "$_roleRaw" } },
          },
        },
      },
      // collapse multiple spaces to one (works fine even if none)
      {
        $addFields: {
          _role: {
            $replaceAll: { input: "$_roleLc", find: "  ", replacement: " " },
          },
        },
      },

      // Map to your dashboard buckets
      {
        $addFields: {
          roleBucket: {
            $switch: {
              branches: [
                {
                  case: {
                    $regexMatch: {
                      input: "$_role",
                      regex: /(journalist|reporter|media)/i,
                    },
                  },
                  then: "journalist",
                },
                {
                  // NOTE: correct regex — no camelCase; allow spacing variants and ASHA workers
                  case: {
                    $regexMatch: {
                      input: "$_role",
                      regex: /(anganwadi\s*worker|anganwadi|asha)/i,
                    },
                  },
                  then: "anganwadiWorker",
                },
                {
                  case: {
                    $regexMatch: {
                      input: "$_role",
                      regex: /(professor|lecturer|teacher|faculty)/i,
                    },
                  },
                  then: "professor",
                },
                {
                  case: {
                    $regexMatch: { input: "$_role", regex: /(doctor|dr\.?)/i },
                  },
                  then: "doctor",
                },
                {
                  case: {
                    $regexMatch: {
                      input: "$_role",
                      regex:
                        /(retired\s*officer|retd|retired|ex[-\s]*officer)/i,
                    },
                  },
                  then: "retired",
                },
              ],
              default: "others",
            },
          },
        },
      },

      // Group to counts
      {
        $group: {
          _id: null,
          journalist: {
            $sum: { $cond: [{ $eq: ["$roleBucket", "journalist"] }, 1, 0] },
          },
          anganwadiWorker: {
            $sum: {
              $cond: [{ $eq: ["$roleBucket", "anganwadiWorker"] }, 1, 0],
            },
          },
          professor: {
            $sum: { $cond: [{ $eq: ["$roleBucket", "professor"] }, 1, 0] },
          },
          doctor: {
            $sum: { $cond: [{ $eq: ["$roleBucket", "doctor"] }, 1, 0] },
          },
          retired: {
            $sum: { $cond: [{ $eq: ["$roleBucket", "retired"] }, 1, 0] },
          },
          others: {
            $sum: { $cond: [{ $eq: ["$roleBucket", "others"] }, 1, 0] },
          },
          total: { $sum: 1 },
        },
      },

      // Ensure others = total - sum(known) (guards against overlap in future edits)
      {
        $addFields: {
          others: {
            $subtract: [
              "$total",
              {
                $add: [
                  "$journalist",
                  "$anganwadiWorker",
                  "$professor",
                  "$doctor",
                  "$retired",
                ],
              },
            ],
          },
        },
      },

      {
        $project: {
          _id: 0,
          journalist: 1,
          anganwadiWorker: 1,
          professor: 1,
          doctor: 1,
          retired: 1,
          others: 1,
          total: 1,
        },
      },
    ]);

    const counts = roleAgg[0] || {
      total,
      journalist: 0,
      anganwadiWorker: 0,
      professor: 0,
      doctor: 0,
      retired: 0,
      others: 0,
    };
    return res.json({
      success: true,
      items,
      counts, // <-- keys exactly: total, journalist, anganwadiWorker, professor, doctor, retired, others
      options: { zones, districts, constituencies },
      pagination: { page: pg, limit: lm, total, pages },
    });
  } catch (err) {
    console.error("NeutralInfluencer dashboard error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
