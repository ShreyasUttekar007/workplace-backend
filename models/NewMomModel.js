const mongoose = require("mongoose");
const { Schema } = mongoose;

const NewMomSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    zone: {
      type: String,
      trim: true,
    },
    district: {
      type: String,
      trim: true,
    },
    pc: {
      type: String,
      trim: true,
    },
    constituency: {
      type: String,
      required: [true, "Please select a constituency"],
      trim: true,
    },
    ward: {
      type: String,
      trim: true,
    }, 
    leaderName: {
      type: String,
      trim: true,
    },
    dom: {
      type: String,
      trim: true,
    },
    designation: {
      type: String,
      trim: true,
    },
    partyName: {
      type: String,
      trim: true,
    },
    placeOfMeeting: {
      type: String,
      trim: true,
    },
    leaderContact: {
      type: String,
      trim: true,
    },
    priority: {
      type: String,
      trim: true,
    },
    makeMom: {
      type: String,
      required: [true, "Please select Yes or No"],
      trim: true,
    },
    keyTakeaways: {
      type: [String],
      trim: true,
    },
    pointOfDiscussion: {
      type: [String],
      trim: true,
    },
    peopleName: {
      type: [String],
      trim: true,
    },
    peopleDesignation: {
      type: [String],
      trim: true,
    },
    peopleParty: {
      type: [String],
      trim: true,
    },
    peoplePhoto: {
      type: [String], 
    },
    leaderPhoto: {
      type: String,
    },
  },
  { timestamps: true }
);

NewMomSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email");
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const NewMom = mongoose.model("NewMom", NewMomSchema);

module.exports = NewMom;
