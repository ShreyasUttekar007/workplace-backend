const mongoose = require("mongoose");
const { Schema } = mongoose;

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
    document: {
      type: String,
    },
    leaveStatus: {
      type: String,
      default: "pending",
    },
  },
  { timestamps: true }
);

LeaveRequestSchema.pre("save", function (next) {
  if (!this.leaveCode) {
    const randomDigits = Math.floor(100000 + Math.random() * 900000); // Generate 6 random digits
    const randomAlphabet = String.fromCharCode(
      65 + Math.floor(Math.random() * 26)
    ); // Generate a random uppercase letter (A-Z)
    this.leaveCode = `LRC-${randomAlphabet}${randomDigits}`;
  }
  next();
});
const LeaveRequest = mongoose.model("LeaveRequest", LeaveRequestSchema);

module.exports = LeaveRequest;
