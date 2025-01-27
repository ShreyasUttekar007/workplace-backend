const express = require("express");
const router = express.Router();
const EmpBiometrics = require("../models/EmpBioMetrics");
const EmpData = require("../models/EmpData");

// CREATE: Add a new Employee Biometric record
router.post("/", async (req, res) => {
  try {
    const empBiometric = new EmpBiometrics(req.body);
    await empBiometric.save();
    res.status(201).json(empBiometric);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/emps/:empId", async (req, res) => {
  try {

    // Step 1: Fetch the Employee Biometric data by empId
    const empBiometric = await EmpBiometrics.findOne({ empId: req.params.empId }).populate("userId", "email");
    
    if (!empBiometric) {
      return res.status(404).json({ error: "Employee Biometric not found" });
    }

    // Step 2: Use empId to fetch corresponding Employee data
    const empData = await EmpData.findOne({ empId: req.params.empId });

    if (!empData) {
      return res.status(404).json({ error: "Employee Data not found" });
    }

    // Step 3: Return the combined data
    const result = {
      biometricData: empBiometric,
      employeeData: {
        empName: empData.empName,
        email: empData.email,
      },
    };

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// READ: Get an Employee Biometric record by empId
router.get("/empId/:empId", async (req, res) => {
  try {
    const empBiometric = await EmpBiometrics.findOne({ empId: req.params.empId }).populate("userId", "email");
    if (!empBiometric) {
      return res.status(404).json({ error: "Employee Biometric not found" });
    }
    res.status(200).json(empBiometric);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// READ: Get an Employee Biometric record by ID
router.get("/:id", async (req, res) => {
  try {
    const empBiometric = await EmpBiometrics.findById(req.params.id).populate("userId", "email");
    if (!empBiometric) {
      return res.status(404).json({ error: "Employee Biometric not found" });
    }
    res.status(200).json(empBiometric);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// UPDATE: Update an Employee Biometric record by ID
router.put("/:id", async (req, res) => {
  try {
    const empBiometric = await EmpBiometrics.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!empBiometric) {
      return res.status(404).json({ error: "Employee Biometric not found" });
    }
    res.status(200).json(empBiometric);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE: Delete an Employee Biometric record by ID
router.delete("/:id", async (req, res) => {
  try {
    const empBiometric = await EmpBiometrics.findByIdAndDelete(req.params.id);
    if (!empBiometric) {
      return res.status(404).json({ error: "Employee Biometric not found" });
    }
    res.status(200).json({ message: "Employee Biometric deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
