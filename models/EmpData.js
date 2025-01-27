const mongoose = require("mongoose");
const { Schema } = mongoose;

const EmployeeSchema = new Schema(
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
    email: {
      type: String,
    },
  },
  { timestamps: true }
);

EmployeeSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const EmpData = mongoose.model("empdata", EmployeeSchema);

module.exports = EmpData;
