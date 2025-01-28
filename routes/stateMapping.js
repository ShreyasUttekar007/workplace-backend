const express = require("express");
const StateInterventionData = require("../models/StateInterventionData");
const User = require("../models/User");
const {
  zoneRoles,
  districtRoles,
  assemblyConstituencies,
  parliamentaryConstituencyRoles,
} = require("../models/roles");
const authenticateUser = require("../middleware/authenticateUser");

const router = express.Router();

router.get(
  "/get-intervention-data/:userId",
  authenticateUser,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const userRoles = req.user?.roles || [];

      // Check if user is admin
      if (userRoles.includes("admin")) {
        const moms = await StateInterventionData.find()
          .populate("userId")
          .sort({ createdAt: -1 });
        return res.status(200).json(moms);
      }

      // Check if the requested userId matches the authenticated user's id
      if (userId !== req.user._id.toString()) {
        return res.status(403).json({ error: "Forbidden - Unauthorized user" });
      }

      // Fetch user info
      const user = await User.findById(req.user._id).select("roles");
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Filter roles for each category
      const userZoneRoles = userRoles.filter((role) =>
        zoneRoles.includes(role)
      );
      const userDistrictRoles = userRoles.filter((role) =>
        districtRoles.includes(role)
      );
      const userConstituencyRoles = userRoles.filter((role) =>
        assemblyConstituencies.includes(role)
      );
      const userParliamentaryConstituencyRoles = userRoles.filter((role) =>
        parliamentaryConstituencyRoles.includes(role)
      );

      // Construct the query dynamically
      const query = {};
      if (userZoneRoles.length > 0) query.zone = { $in: userZoneRoles };
      if (userDistrictRoles.length > 0)
        query.district = { $in: userDistrictRoles };
      if (userConstituencyRoles.length > 0)
        query.constituency = { $in: userConstituencyRoles };
      if (userParliamentaryConstituencyRoles.length > 0) {
        query.zone = { $in: userParliamentaryConstituencyRoles };
      }

      // If no roles match, only fetch MOMs for the specific user
      if (Object.keys(query).length === 0) {
        query.userId = userId;
      }

      // Fetch data from DB
      const moms = await StateInterventionData.find(query)
        .populate("userId")
        .sort({ createdAt: -1 });
      return res.status(200).json(moms);
    } catch (error) {
      console.error("Error fetching MOM data: ", error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.post("/create-intervention", async (req, res) => {
  try {
    const booth = new StateInterventionData(req.body);
    const savedBooth = await booth.save();
    res.status(201).json(savedBooth);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get(
  "/get-intervention-data-by-constituency/:constituency",
  async (req, res) => {
    try {
      const { constituency } = req.params;

      // Find all records for the given constituency
      const constituencyData = await StateInterventionData.find({
        constituency,
      });

      if (!constituencyData || constituencyData.length === 0) {
        return res
          .status(404)
          .json({ error: "No data found for this constituency" });
      }

      // Directly send the fetched data
      res.json(constituencyData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
);

router.put("/update-intervention-action/:id", async (req, res) => {
  const { id } = req.params;
  const { interventionAction } = req.body;

  try {
    // Update the BoothData record by ID
    const updatedData = await StateInterventionData.findByIdAndUpdate(
      id,
      { interventionAction }, // Only update the interventionAction
      { new: true } // Return the updated document
    );

    if (!updatedData) {
      return res.status(404).json({ error: "No record found with this ID" });
    }

    res.json(updatedData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/get-interventions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch the StateInterventionData document by ID
    const interventionData = await StateInterventionData.findById(id);

    if (!interventionData) {
      return res.status(404).json({ error: "No record found with this ID" });
    }

    res.json(interventionData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update-intervention-data/:id", async (req, res) => {
  const { id } = req.params;
  const updateFields = req.body; // Expecting the full object for updating

  try {
    // Update the entire record by ID
    const updatedData = await StateInterventionData.findByIdAndUpdate(
      id,
      updateFields, // Update with the provided fields
      { new: true } // Return the updated document
    );

    if (!updatedData) {
      return res.status(404).json({ error: "No record found with this ID" });
    }

    res.json(updatedData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/interventions/counts", authenticateUser, async (req, res) => {
  try {
    const {
      constituency,
      district,
      zone,
      interventionType,
      interventionAction,
      fromDate,
      toDate,
    } = req.query;
    const userRoles = req.user?.roles || [];

    // Start of date filter debug
    let matchFilter = {};
    if (fromDate && toDate) {
      const startDate = new Date(fromDate); // fromDate is '2025-01-14T00:00:00.000Z'
      const endDate = new Date(toDate); // toDate is '2025-01-14T00:00:00.000Z'

      // Adjust endDate to cover the entire day in UTC
      endDate.setUTCHours(23, 59, 59, 999);
      matchFilter.createdAt = { $gte: startDate, $lte: endDate };

      if (startDate <= endDate) {
        matchFilter.createdAt = { $gte: startDate, $lte: endDate };
      }
    }

    // Apply additional filters based on query parameters
    if (constituency) matchFilter.constituency = constituency;
    if (district) matchFilter.district = district;
    if (zone) matchFilter.zone = zone.replace(/\+/g, " "); // Decode '+' as space
    if (interventionType) matchFilter.interventionType = interventionType;
    if (interventionAction) matchFilter.interventionAction = interventionAction;

    const userZoneRoles = userRoles.filter((role) => zoneRoles.includes(role));
    const userDistrictRoles = userRoles.filter((role) =>
      districtRoles.includes(role)
    );
    const userConstituencyRoles = userRoles.filter((role) =>
      assemblyConstituencies.includes(role)
    );
    const userParliamentaryConstituencyRoles = userRoles.filter((role) =>
      parliamentaryConstituencyRoles.includes(role)
    );

    if (userZoneRoles.length > 0) matchFilter.zone = { $in: userZoneRoles };
    if (userDistrictRoles.length > 0)
      matchFilter.district = { $in: userDistrictRoles };
    if (userConstituencyRoles.length > 0)
      matchFilter.constituency = { $in: userConstituencyRoles };
    if (userParliamentaryConstituencyRoles.length > 0)
      matchFilter.zone = { $in: userParliamentaryConstituencyRoles };

    // Perform aggregation
    const counts = await getInterventionCounts(matchFilter);

    res.json(counts);
  } catch (error) {
    console.error("Error fetching intervention counts:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Helper function for admin counts
async function handleAdminCounts(matchFilter) {
  const counts = await StateInterventionData.aggregate([
    {
      $match: matchFilter, // Apply admin-specific filters
    },
    {
      $facet: {
        totalInterventions: [{ $count: "count" }],
        typeCounts: [
          {
            $match: {
              interventionType: {
                $in: [
                  "Political",
                  "Party / Organizational",
                  "Government / Administrative",
                  "Alliance",
                  "Leader Activation",
                ],
              },
            },
          },
          {
            $group: {
              _id: "$interventionType",
              count: { $sum: 1 },
            },
          },
        ],
        actionCounts: [
          {
            $match: {
              interventionAction: {
                $in: ["Solved", "Not Solved", "Action Taken", "Reviewed"],
              },
            },
          },
          {
            $group: {
              _id: "$interventionAction",
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
    {
      $project: {
        totalInterventions: {
          $arrayElemAt: ["$totalInterventions.count", 0],
        },
        typeCounts: {
          $arrayToObject: {
            $map: {
              input: "$typeCounts",
              as: "type",
              in: { k: "$$type._id", v: "$$type.count" },
            },
          },
        },
        actionCounts: {
          $arrayToObject: {
            $map: {
              input: "$actionCounts",
              as: "action",
              in: { k: "$$action._id", v: "$$action.count" },
            },
          },
        },
      },
    },
  ]);

  return formatCounts(counts[0]);
}

// Helper function for non-admin counts
async function getInterventionCounts(matchFilter) {
  const counts = await StateInterventionData.aggregate([
    {
      $match: matchFilter, // Apply user-specific filters
    },
    {
      $facet: {
        totalInterventions: [{ $count: "count" }],
        typeCounts: [
          {
            $match: {
              interventionType: {
                $in: [
                  "Political",
                  "Party / Organizational",
                  "Government / Administrative",
                  "Alliance",
                  "Leader Activation",
                ],
              },
            },
          },
          {
            $group: {
              _id: "$interventionType",
              count: { $sum: 1 },
            },
          },
        ],
        actionCounts: [
          {
            $match: {
              interventionAction: {
                $in: ["Solved", "Not Solved", "Action Taken", "Reviewed"],
              },
            },
          },
          {
            $group: {
              _id: "$interventionAction",
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
    {
      $project: {
        totalInterventions: {
          $arrayElemAt: ["$totalInterventions.count", 0],
        },
        typeCounts: {
          $arrayToObject: {
            $map: {
              input: "$typeCounts",
              as: "type",
              in: { k: "$$type._id", v: "$$type.count" },
            },
          },
        },
        actionCounts: {
          $arrayToObject: {
            $map: {
              input: "$actionCounts",
              as: "action",
              in: { k: "$$action._id", v: "$$action.count" },
            },
          },
        },
      },
    },
  ]);

  return formatCounts(counts[0]);
}

// Helper function to format counts
function formatCounts(counts) {
  const result = counts || {
    totalInterventions: 0,
    typeCounts: {},
    actionCounts: {},
  };

  const allTypes = [
    "Political",
    "Party / Organizational",
    "Government / Administrative",
    "Alliance",
    "Leader Activation",
  ];
  const allActions = ["Solved", "Not Solved", "Action Taken", "Reviewed"];

  allTypes.forEach((type) => {
    if (!result.typeCounts[type]) {
      result.typeCounts[type] = 0;
    }
  });

  allActions.forEach((action) => {
    if (!result.actionCounts[action]) {
      result.actionCounts[action] = 0;
    }
  });

  return result;
}

router.delete("/delete-intervention-data/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Find and delete the document by ID
    const deletedData = await StateInterventionData.findByIdAndDelete(id);

    if (!deletedData) {
      return res.status(404).json({ error: "No record found with this ID" });
    }

    res.json({ message: "Record deleted successfully", data: deletedData });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
