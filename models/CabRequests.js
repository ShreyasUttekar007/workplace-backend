const mongoose = require("mongoose");
const EmployeeLeave = require("../models/EmployeeData");

const cabRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    cabRequestCode: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      trim: true,
    },
    employeeCode: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
    },
    dateOfRequest: {
      type: String,
      trim: true,
    },
    employeePhoneNumber: {
      type: String,
      trim: true,
    },
    pickupTime: {
      type: String,
      trim: true,
    },
    pickupLocation: {
      type: String,
      trim: true,
    },
    purpose: {
      type: String,
      trim: true,
    },
    recieverEmail: {
      type: String,
      trim: true,
    },
    recieverName: {
      type: String,
      trim: true,
    },
    startTime: {
      type: String,
      trim: true,
    },
    speedometerStartPhoto: {
      type: String,
      trim: true,
    },
    startingDistance: {
      type: String,
      trim: true,
    },
    endTime: {
      type: String,
      trim: true,
    },
    speedometerEndPhoto: {
      type: String,
      trim: true,
    },
    endKm: {
      type: String,
      trim: true,
    },
    cabNumber: {
      type: String,
      trim: true,
    },
    driverName: {
      type: String,
      trim: true,
    },
    driverNumber: {
      type: String,
      trim: true,
    },
    remarks: {
      type: String,
      trim: true,
    },
    vendor: {
      type: String,
      trim: true,
    },
    addOnPerson: [
      {
        employeeName: { type: String, trim: true },
        employeePhoneNumber: { type: String, trim: true },
        employeeEmail: { type: String, trim: true },
      },
    ],
  },
  { timestamps: true }
);

cabRequestSchema.pre("save", async function (next) {
  if (!this.cabRequestCode) {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    const randomAlphabet = String.fromCharCode(
      65 + Math.floor(Math.random() * 26)
    );
    this.cabRequestCode = `CRC-${randomAlphabet}${randomDigits}`;
  }

  if (!this.email) {
    return next(new Error("Email is missing in cab request data."));
  }

  const emailToSearch = this.email.toLowerCase();
  try {
    const employee = await EmployeeLeave.findOne({
      employeeEmail: { $regex: new RegExp(`^${emailToSearch}$`, "i") },
    });

    if (employee) {
      this.employeeCode = employee.employeeCode;
      this.name = employee.employeeName;
      this.employeePhoneNumber = employee.employeePhoneNumber;
      this.recieverEmail = employee.reportingManagerEmail;
      this.recieverName = employee.reportingManager;
    } else {
      return next(
        new Error(`Employee data not found for email: ${this.email}`)
      );
    }
  } catch (err) {
    return next(err);
  }

  next();
});

const CabRequest = mongoose.model("CabRequest", cabRequestSchema);

module.exports = CabRequest;
