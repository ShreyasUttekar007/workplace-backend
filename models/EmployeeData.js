const mongoose = require("mongoose");

const employeeLeaveSchema = new mongoose.Schema(
  {
    gender: {
      type: String,
    },
    employeeEmail: { type: String, unique: true },
    employeeName: {
      type: String,
    },
    employeePhoneNumber: {
      type: String,
    },
    department: {
      type: String,
    },
    role: {
      type: String,
    },
    employeeCode: {
      type: String,
    },
    sickLeave: {
      type: String,
    },
    paidLeave: {
      type: String,
    },
    restrictedHoliday: {
      type: String,
    },
    menstrualLeave: {
      type: String,
    },
    reportingManager: {
      type: String,
    },
    reportingManagerCode: {
      type: String,
    },
    reportingManagerEmail: {
      type: String,
    },
    reportingManager2: {
      type: String,
    },
    reportingManagerCode2: {
      type: String,
    },
    reportingManagerEmail2: {
      type: String,
    },
    regularizationLeave: {
      type: String,
    },
    compensationLeave: {
      type: String,
    },
    onOfficeDuty: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const EmployeeLeave = mongoose.model("employeeData", employeeLeaveSchema);

module.exports = EmployeeLeave;
