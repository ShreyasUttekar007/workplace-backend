const mongoose = require("mongoose");
const { Schema } = mongoose;

const probableJoineeSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    state: { type: String },
    zone: { type: String },
    pc: { type: String },
    constituency: { type: String },
    ward: { type: String },
    vibhagPramukhName: { type: String },
    vibhagPramukhContactNo: { type: String },
    probableJoineeName: { type: String },
    age: { type: String },
    gender: { type: String },
    caste: { type: String },
    phoneNo: { type: String },
    party: { type: String },
    photo: { type: String },
    designation: { type: String },
    briefProfile: { type: String },
    publicImage: { type: String },
    financialStatus: { type: String },
    voterInfluence: { type: String },
    areaOfInfluence: { type: String },
    viability: { type: String },
    leaderWhoInformedSTC: { type: String },
    vibhagPramukhAgreed: { type: String },
    mlaOrMpAgreed: { type: String },
    stcRecommendation: { type: String },
    stcRecommendationReason: { type: String },
    facilitator: { type: String },
    demand: { type: String },
    offer: { type: String },
    leadersToManage: { type: String },
    status: { type: String },
    discussionWithJoinee: { type: String },
  },
  { timestamps: true }
);

const ProbableJoinee = mongoose.model("ProbableJoinee", probableJoineeSchema);
module.exports = ProbableJoinee;
