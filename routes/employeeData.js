const express = require("express");
const EmployeeLeave = require("../models/EmployeeData");
const authenticateUser = require("../middleware/authenticateUser");

const router = express.Router();

// API to get the reportingManagerEmail by employeeEmail
router.get("/get-manager-email/:employeeEmail", async (req, res) => {
  const { employeeEmail } = req.params;

  try {

    // Case-insensitive search
    const employee = await EmployeeLeave.findOne({
      employeeEmail: { $regex: new RegExp(`^${employeeEmail}$`, "i") },
    });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Include both reportingManager and reportingManagerEmail in the response
    res.status(200).json({
      reportingManager: employee.reportingManager,
      reportingManagerEmail: employee.reportingManagerEmail,
    });
  } catch (error) {
    console.error("Error fetching manager details:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// API to get leave data by employeeEmail
router.get("/get-leave-data/:employeeEmail", async (req, res) => {
  const { employeeEmail } = req.params;

  try {

    // Case-insensitive search
    const employee = await EmployeeLeave.findOne({
      employeeEmail: { $regex: new RegExp(`^${employeeEmail}$`, "i") },
    });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // Format leave data
    const formatLeaveData = (leaveField) => {
      if (!leaveField || leaveField.trim() === "") {
        return "0"; // Default to 0 for empty fields
      }
      if (leaveField.toLowerCase() === "probation") {
        return "NA"; // Display NA or no data for probation
      }
      return leaveField; // Return the original value if it doesn't match the above cases
    };

    const leaveData = {
      sickLeave: formatLeaveData(employee.sickLeave),
      paidLeave: formatLeaveData(employee.paidLeave),
      restrictedHoliday: formatLeaveData(employee.restrictedHoliday),
      menstrualLeave: formatLeaveData(employee.menstrualLeave),
    };

    res.status(200).json({ leaveData });
  } catch (error) {
    console.error("Error fetching leave data:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/update-data", async (req, res) => {
  const {
    gender,
    employeeCode,
    employeeName,
    department,
    role,
    employeeEmail,
    sickLeave,
    paidLeave,
    restrictedHoliday,
    menstrualLeave,
    reportingManager,
    reportingManagerCode,
    reportingManagerEmail,
  } = req.body;

  try {
    // Check if the employee exists
    const existingEmployee = await EmployeeLeave.findOne({
      employeeEmail: { $regex: new RegExp(`^${employeeEmail}$`, "i") }, // Case-insensitive match
    });

    if (existingEmployee) {
      // Update the existing employee
      existingEmployee.gender = gender || existingEmployee.gender;
      existingEmployee.employeeCode = employeeCode || existingEmployee.employeeCode;
      existingEmployee.employeeName = employeeName || existingEmployee.employeeName;
      existingEmployee.department = department || existingEmployee.department;
      existingEmployee.role = role || existingEmployee.role;
      existingEmployee.sickLeave = sickLeave || existingEmployee.sickLeave;
      existingEmployee.paidLeave = paidLeave || existingEmployee.paidLeave;
      existingEmployee.restrictedHoliday = restrictedHoliday || existingEmployee.restrictedHoliday;
      existingEmployee.menstrualLeave = menstrualLeave || existingEmployee.menstrualLeave;
      existingEmployee.reportingManager = reportingManager || existingEmployee.reportingManager;
      existingEmployee.reportingManagerCode =
        reportingManagerCode || existingEmployee.reportingManagerCode;
      existingEmployee.reportingManagerEmail =
        reportingManagerEmail || existingEmployee.reportingManagerEmail;

      await existingEmployee.save();

      return res.status(200).json({ message: "Employee data updated successfully" });
    }

    // If employee does not exist, create a new entry
    const newEmployee = new EmployeeLeave({
      gender,
      employeeCode,
      employeeName,
      department,
      role,
      employeeEmail,
      sickLeave,
      paidLeave,
      restrictedHoliday,
      menstrualLeave,
      reportingManager,
      reportingManagerCode,
      reportingManagerEmail,
    });

    await newEmployee.save();

    res.status(201).json({ message: "New employee entry created successfully" });
  } catch (error) {
    console.error("Error updating/creating data:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/get-updated-data", async (req, res) => {
  try {
    const employees = await EmployeeLeave.find(); // Fetch all employees from DB
    res.status(200).json({ data: employees });
  } catch (error) {
    console.error("Error fetching updated data:", error);
    res.status(500).json({ message: "Error fetching data from the database" });
  }
});



module.exports = router;
