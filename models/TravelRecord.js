const mongoose = require("mongoose");
const EmployeeLeave = require("./EmployeeData");
const { Schema } = mongoose;

const TravelRequestSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    travelCode: {
      type: String,
      unique: true,
    },
    department: { type: String, trim: true },
    requestType: { type: String, trim: true },
    travelDate: { type: Date, trim: true },
    fromLocation: { type: String, trim: true },
    toLocation: { type: String, trim: true },
    accommodationStartDate: { type: Date, trim: true },
    accommodationEndDate: { type: Date, trim: true },
    purposeOfTravel: { type: String, trim: true },
    eventDetails: { type: String, trim: true },
    eventLocation: { type: String, trim: true },
    remarks: { type: String, trim: true },
    travelInstructedBy: { type: String, trim: true },
    eventName: { type: String, trim: true },
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
    employeePhoneNumber: {
      type: String,
      trim: true,
    },
    requestStatus: {
      type: String,
      trim: true,
      default: "pending",
    },
    age: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

TravelRequestSchema.pre("save", async function (next) {

  if (!this.travelCode) {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    const randomAlphabet = String.fromCharCode(
      65 + Math.floor(Math.random() * 26)
    );
    this.travelCode = `TRC-${randomAlphabet}${randomDigits}`;
  }

  if (!this.email) {
    return next(new Error("Email is missing in travel request data."));
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
      this.department = employee.department;
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

const TravelRequest = mongoose.model("TravelRequest", TravelRequestSchema);

module.exports = TravelRequest;
