const express = require("express");
const BmcMapping = require("../models/BmcMapping");
const InterventionData = require("../models/InterventionData");

const router = express.Router();

// router.get("/bmc-mappings", async (req, res) => {
//   try {
//     const { constituency, zone, pc, role } = req.query;

//     // Build the query filter dynamically
//     const filter = {};

//     if (role === "admin") {
//       // Admin role: Fetch all records
//       const data = await BmcMapping.find({});
//       return res.status(200).json(data);
//     }

//     if (constituency) {
//       // If constituency is provided, handle single or multiple values
//       filter.constituency = { $in: Array.isArray(constituency) ? constituency : [constituency] };
//     }

//     if (zone) {
//       // If zone is provided, handle single or multiple values
//       filter.zone = { $in: Array.isArray(zone) ? zone : [zone] };
//     }

//     if (pc) {
//       // If PC is provided, handle single or multiple values
//       filter.pc = { $in: Array.isArray(pc) ? pc : [pc] };
//     }

//     // Fetch records based on the filter
//     const data = await BmcMapping.find(filter);

//     // If no data is found, return a 404 response
//     if (data.length === 0) {
//       return res.status(404).json({ message: "No data found for the given criteria." });
//     }

//     // Respond with the fetched data
//     res.status(200).json(data);
//   } catch (error) {
//     console.error("Error fetching BMC mappings:", error);
//     res.status(500).json({ message: "Internal Server Error" });
//   }
// });

router.get('/bmc-mappings', async (req, res) => {
  try {
    const { role } = req.query;

    // Check if the role is 'admin'
    if (role !== 'admin') {
      return res.status(403).json({ message: "You must have the 'admin' role to access this data." });
    }

    // Fetch distinct pc and constituency values from InterventionData
    const pcs = await InterventionData.distinct('pc');
    const constituencies = await InterventionData.distinct('constituency');

    // Respond with the pc and constituency data
    res.status(200).json({ pcs, constituencies });
  } catch (error) {
    console.error('Error fetching pc and constituency data:', error);
    res.status(500).json({ message: 'Internal Server Error' });
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
      return res.status(404).json({ message: "No wards found for the given constituency." });
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

router.get("/get-intervention-data", async (req, res) => {
  try {
    const { constituency, ward, pc, interventionType, interventionAction } =
      req.query;

    // Build the query object based on filters
    const query = {};

    if (constituency) {
      query.constituency = constituency;
    }

    if (ward) {
      query.ward = ward; // Filter based on ward
    }

    if (pc) {
      query.pc = pc; // Filter based on parliamentary constituency
    }

    if (interventionType) {
      query.interventionType = interventionType;
    }

    if (interventionAction) {
      query.interventionAction = interventionAction; // Filter based on interventionAction
    }

    // Find records based on the query, sorted by latest first
    const interventionData = await InterventionData.find(query).sort({
      createdAt: -1,
    });

    if (!interventionData || interventionData.length === 0) {
      return res
        .status(404)
        .json({ error: "No data found for the given criteria" });
    }

    // Send the data directly without mapping fields
    res.json(interventionData);
  } catch (error) {
    console.error("Error fetching intervention data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

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

    // Build the match filter dynamically
    const matchFilter = {};

    if (constituency) {
      matchFilter.constituency = constituency;
    }

    if (ward) {
      matchFilter.ward = ward; // Filter by ward
    }

    if (pc) {
      matchFilter.pc = pc; // Filter by parliamentary constituency
    }

    if (interventionType) {
      matchFilter.interventionType = interventionType;
    }

    if (interventionAction) {
      matchFilter.interventionAction = interventionAction;
    }

    const counts = await InterventionData.aggregate([
      {
        $match: matchFilter, // Apply the match filter
      },
      {
        $facet: {
          totalInterventions: [{ $count: "count" }], // Total count of interventions
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

module.exports = router;
