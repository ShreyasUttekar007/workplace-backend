const mongoose = require("mongoose");
const { Schema } = mongoose;

const EmployeeBiometricSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    empId: {
      type: String,
    },
    empName: {
      type: String,
    },
    month: {
        type: String,
      },
    date: [
      {
        type: String,
      },
    ],
  },
  { timestamps: true }
);

EmployeeBiometricSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    console.log("User Email:", this.userId.email);
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const EmpBiometrics = mongoose.model("empbiometrics", EmployeeBiometricSchema);

module.exports = EmpBiometrics;
