const express = require("express");
const BmcMapping = require("../models/BmcMapping");
const InterventionData = require("../models/InterventionData");
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
        const moms = await InterventionData.find().populate("userId");
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

      console.log("Roles Breakdown:");
      console.log("Zone Roles: ", userZoneRoles);
      console.log("District Roles: ", userDistrictRoles);
      console.log("Constituency Roles: ", userConstituencyRoles);
      console.log(
        "Parliamentary Constituency Roles: ",
        userParliamentaryConstituencyRoles
      );

      // Construct the query dynamically
      const query = {};
      if (userZoneRoles.length > 0) query.zone = { $in: userZoneRoles };
      if (userDistrictRoles.length > 0)
        query.district = { $in: userDistrictRoles };
      if (userConstituencyRoles.length > 0)
        query.constituency = { $in: userConstituencyRoles };
      if (userParliamentaryConstituencyRoles.length > 0) {
        query.pc = { $in: userParliamentaryConstituencyRoles };
      }

      // If no roles match, only fetch MOMs for the specific user
      if (Object.keys(query).length === 0) {
        query.userId = userId;
      }
      console.log("Constructed Query: ", query);

      // Fetch data from DB
      const moms = await InterventionData.find(query).populate("userId");
      return res.status(200).json(moms);
    } catch (error) {
      console.error("Error fetching MOM data: ", error);
      return res.status(500).json({ error: error.message });
    }
  }
);

router.get("/get-wards/:constituency", async (req, res) => {
  const { constituency } = req.params;

  try {
    // Fetch distinct ward numbers for the given constituency
    const wards = await BmcMapping.find({ constituency }).distinct(
      "wardNumber"
    );

    if (wards.length === 0) {
      return res
        .status(404)
        .json({ message: "No wards found for the selected constituency" });
    }

    res.status(200).json({ wards });
  } catch (error) {
    console.error("Error fetching wards:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/wards", authenticateUser, async (req, res) => {
  try {
    const { constituency } = req.query;

    if (!constituency) {
      return res.status(400).json({ message: "Constituency is required." });
    }

    // Find the wards for the given constituency using InterventionData model
    const wardsData = await InterventionData.distinct("ward", { constituency });

    // If no wards are found, return a 404 response
    if (wardsData.length === 0) {
      return res
        .status(404)
        .json({ message: "No wards found for the given constituency." });
    }

    // Respond with the list of wards
    res.status(200).json(wardsData);
  } catch (error) {
    console.error("Error fetching wards:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.post("/create-intervention", async (req, res) => {
  try {
    const booth = new InterventionData(req.body);
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
      const constituencyData = await InterventionData.find({ constituency });

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

router.put(
  "/update-intervention-action/:id",
  authenticateUser,
  async (req, res) => {
    const { id } = req.params;
    const { interventionAction } = req.body;

    try {
      // Update the BoothData record by ID
      const updatedData = await InterventionData.findByIdAndUpdate(
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
  }
);

router.get("/interventions/counts", authenticateUser, async (req, res) => {
  try {
    const { constituency, ward, pc, interventionType, interventionAction } = req.query;
    const userRoles = req.user?.roles || [];

    console.log("Query Parameters:", {
      constituency,
      ward,
      pc,
      interventionType,
      interventionAction,
    });
    console.log("User Roles:", userRoles);

    // Check if the user is admin
    if (userRoles.includes("admin")) {
      console.log("Admin detected: Applying filters.");
      const matchFilter = {};

      // Apply filters dynamically for admin
      if (constituency) matchFilter.constituency = constituency;
      if (ward) matchFilter.ward = ward;
      if (pc) matchFilter.pc = pc.replace(/\+/g, " "); // Decode '+' as space
      if (interventionType) matchFilter.interventionType = interventionType;
      if (interventionAction) matchFilter.interventionAction = interventionAction;

      console.log("Admin Match Filter:", JSON.stringify(matchFilter, null, 2));
      const result = await handleAdminCounts(matchFilter);
      console.log("Admin Result:", JSON.stringify(result, null, 2));
      return res.json(result);
    }

    // Filter roles for other users
    const userZoneRoles = userRoles.filter((role) => zoneRoles.includes(role));
    const userDistrictRoles = userRoles.filter((role) => districtRoles.includes(role));
    const userConstituencyRoles = userRoles.filter((role) =>
      assemblyConstituencies.includes(role)
    );
    const userParliamentaryConstituencyRoles = userRoles.filter((role) =>
      parliamentaryConstituencyRoles.includes(role)
    );

    // Construct the match filter dynamically
    const matchFilter = {};

    if (userZoneRoles.length > 0) matchFilter.zone = { $in: userZoneRoles };
    if (userDistrictRoles.length > 0) matchFilter.district = { $in: userDistrictRoles };
    if (userConstituencyRoles.length > 0)
      matchFilter.constituency = { $in: userConstituencyRoles };
    if (userParliamentaryConstituencyRoles.length > 0)
      matchFilter.pc = { $in: userParliamentaryConstituencyRoles };

    // Further filter by query parameters if provided
    if (constituency) matchFilter.constituency = constituency;
    if (ward) matchFilter.ward = ward;
    if (pc) matchFilter.pc = pc.replace(/\+/g, " ");
    if (interventionType) matchFilter.interventionType = interventionType;
    if (interventionAction) matchFilter.interventionAction = interventionAction;

    console.log("Final Match Filter for non-admin:", JSON.stringify(matchFilter, null, 2));

    // Perform aggregation
    const counts = await getInterventionCounts(matchFilter);

    console.log("Final Processed Result:", JSON.stringify(counts, null, 2));
    res.json(counts);
  } catch (error) {
    console.error("Error fetching intervention counts:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Helper function for admin counts
async function handleAdminCounts(matchFilter) {
  const counts = await InterventionData.aggregate([
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
                $in: ["Solved", "Not Solved", "Action Taken"],
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
  const counts = await InterventionData.aggregate([
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
                $in: ["Solved", "Not Solved", "Action Taken"],
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
  const allActions = ["Solved", "Not Solved", "Action Taken"];

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

module.exports = router;
