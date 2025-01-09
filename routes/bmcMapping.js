const express = require("express");
const BmcMapping = require("../models/BmcMapping");
const InterventionData = require("../models/InterventionData");

const router = express.Router();

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

router.post("/create-intervention", async (req, res) => {
  try {
    const booth = new InterventionData(req.body);
    const savedBooth = await booth.save();
    res.status(201).json(savedBooth);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/get-intervention-data-by-constituency/:constituency", async (req, res) => {
    try {
      const { constituency } = req.params;
  
      // Find all records for the given constituency
      const constituencyData = await InterventionData.find({ constituency });
  
      if (!constituencyData || constituencyData.length === 0) {
        return res.status(404).json({ error: "No data found for this constituency" });
      }
  
      // Directly send the fetched data
      res.json(constituencyData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  

module.exports = router;
