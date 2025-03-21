const mongoose = require("mongoose");
const { Schema } = mongoose;
const EmployeeLeave = require("./EmployeeData");

const LeaveRequestSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please provide your email"],
      trim: true,
    },
    receiverEmail: {
      type: String,
      required: [true, "Please provide your email"],
      trim: true,
    },
    receiverName: {
      type: String,
      required: [true, "Please provide your name"],
      trim: true,
    },
    leaveType: {
      type: String,
      required: [true, "Please provide the type of leave"],
      trim: true,
    },
    reasonForLeave: {
      type: String,
      required: [true, "Please provide the reason for leave"],
      trim: true,
    },
    startDate: {
      type: Date,
      required: [true, "Please provide the start date for leave"],
    },
    endDate: {
      type: Date,
      required: [true, "Please provide the end date for leave"],
    },
    summaryForLeave: {
      type: String,
      trim: true,
    },
    leaveCode: {
      type: String,
      unique: true,
    },
    employeeCode: {
      type: String,
      unique: true,
    },
    document: {
      type: String,
    },
    leaveStatus: {
      type: String,
      default: "pending",
    },
    department: { type: String, trim: true },
    reportingManagerEmail: {
      type: String,
      trim: true,
    },
    reportingManager: {
      type: String,
      trim: true,
    },
    reportingManagerEmail2: {
      type: String,
      trim: true,
    },
    reportingManager2: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Pre-save middleware
LeaveRequestSchema.pre("save", async function (next) {
  // Generate leaveCode if not already set
  if (!this.leaveCode) {
    const randomDigits = Math.floor(100000 + Math.random() * 900000); // Generate 6 random digits
    const randomAlphabet = String.fromCharCode(
      65 + Math.floor(Math.random() * 26)
    ); // Generate a random uppercase letter (A-Z)
    this.leaveCode = `LRC-${randomAlphabet}${randomDigits}`;
  }

  // Fetch the employeeCode from the EmployeeLeave model using the email
  if (!this.employeeCode) {
    try {
      const employee = await EmployeeLeave.findOne({
        employeeEmail: this.email,
      });
      if (employee) {
        this.employeeCode = employee.employeeCode;
        this.department = employee.department;
      } else {
        return next(
          new Error("Employee data not found for the provided email.")
        );
      }
    } catch (err) {
      return next(err);
    }
  }

  next();
});

const LeaveRequest = mongoose.model("LeaveRequest", LeaveRequestSchema);

module.exports = LeaveRequest;
