const mongoose = require("mongoose");
const { Schema } = mongoose;

const CandidateListSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    zone: {
      type: String,
      required: [true, "Please select a Zone"],
      trim: true,
    },
    district: {
      type: String,
      required: [true, "Please select a District"],
      trim: true,
    },
    constituency: {
      type: String,
      required: [true, "Please select a Constituency"],
      trim: true,
    },
    candidateNameEnglish: {
      type: String,
    },
    candidateNameMarathi: {
      type: String,
    },
    casteEnglish: {
      type: String,
    },
    ageEnglish: {
      type: String,
    },
    genderEnglish: {
      type: String,
    },
    candidatePartyFullName: {
      type: String,
    },
    alliance: {
      type: String,
    },
  },
  { timestamps: true }
);

CandidateListSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    console.log("User Email:", this.userId.email);
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const Candidate = mongoose.model("CandidateList", CandidateListSchema);

module.exports = Candidate;
