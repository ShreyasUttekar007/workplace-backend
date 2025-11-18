const mongoose = require("mongoose");
const { Schema } = mongoose;
const Booths = require("../models/BoothList");
const BoothsAp = require("../models/BoothListAP");

const NewMomSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    state: {
      type: String,
      trim: true,
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
    gMapLocation: {
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
    typeOfMeeting: {
      type: String,
      trim: true,
    },
    meetingStatus: {
      type: String,
      trim: true,
    },
    eventName: {
      type: String,
      trim: true,
    },
    eventDetails: {
      type: String,
      trim: true,
    },
    eventLocation: {
      type: String,
      trim: true,
    },
    eventPocName: {
      type: String,
      trim: true,
    },
    eventPocNumber: {
      type: String,
      trim: true,
    },
    remarks: {
      type: String,
      trim: true,
    },
    eventPhotos: {
      type: [String],
    },
  },
  { timestamps: true }
);

NewMomSchema.pre("save", async function (next) {
  try {
    // Fetch email of the userId if needed
    const user = await mongoose
      .model("User")
      .findById(this.userId)
      .select("email");

    let stateData;

    // Check state and fetch data from the appropriate collection
    if (this.state === "Maharashtra") {
      stateData = await Booths.findOne({ constituency: this.constituency });
    } else if (this.state === "Andhra Pradesh") {
      stateData = await BoothsAp.findOne({ constituency: this.constituency });
    } else if (this.state === "Bengal") {
      stateData = await BoothsAp.findOne({ constituency: this.constituency });
    } else if (this.state === "Uttar Pradesh") {
      stateData = await BoothsAp.findOne({ constituency: this.constituency });
    }
    // If data is found, assign values
    if (stateData) {
      this.zone = stateData.zone;
      this.district = stateData.district;
      this.pc = stateData.pc;
    }

    next(); // Ensure next is only called once
  } catch (error) {
    next(error); // Properly pass errors to the next middleware
  }
});

const NewMom = mongoose.model("NewMom", NewMomSchema);
module.exports = NewMom;
