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

router.use(authenticateUser);

router.get("/get-intervention-data/:userId", async (req, res) => {
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
});

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

router.get("/wards", async (req, res) => {
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

router.put("/update-intervention-action/:id", async (req, res) => {
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
});

router.get("/interventions/counts", async (req, res) => {
  try {
    const { constituency, ward, pc, interventionType, interventionAction } =
      req.query;
    const userRoles = req.user?.roles || [];

    // Check if the user is admin (for fetching all data)
    if (userRoles.includes("admin")) {
      const result = await handleAdminCounts(); // Wait for result here
      return res.json(result);
    }

    // Filter roles for each category
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
    // Construct the query dynamically based on roles
    const matchFilter = {};

    if (userZoneRoles.length > 0) matchFilter.zone = { $in: userZoneRoles };
    if (userDistrictRoles.length > 0)
      matchFilter.district = { $in: userDistrictRoles };
    if (userConstituencyRoles.length > 0)
      matchFilter.constituency = { $in: userConstituencyRoles };
    if (userParliamentaryConstituencyRoles.length > 0)
      matchFilter.pc = { $in: userParliamentaryConstituencyRoles };

    // Further filter by query parameters if provided
    if (constituency) matchFilter.constituency = constituency;
    if (ward) matchFilter.ward = ward;
    if (pc) matchFilter.pc = pc;
    if (interventionType) matchFilter.interventionType = interventionType;
    if (interventionAction) matchFilter.interventionAction = interventionAction;

    console.log("Match Filter:", matchFilter);

    // Perform the aggregation to get counts
    const counts = await InterventionData.aggregate([
      {
        $match: matchFilter, // Apply the match filter dynamically
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

    // If no interventions exist, return zero counts
    const result = counts[0] || {
      totalInterventions: 0,
      typeCounts: {},
      actionCounts: {},
    };

    // Fill missing intervention types and actions with 0 counts
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

    res.json(result);
  } catch (error) {
    console.error("Error fetching intervention counts:", error);
    res.status(500).send("Internal Server Error");
  }
});

// Updated handleAdminCounts function:
async function handleAdminCounts() {
  const counts = await InterventionData.aggregate([
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

  const result = counts[0] || {
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

  return result; // Return the result here, instead of trying to send the response directly
}

module.exports = router;
