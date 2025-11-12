const mongoose = require("mongoose");

const BmcMappingSchema = new mongoose.Schema(
  {
    zone: {
      type: String,
      required: true,
      trim: true,
    },
    pc: {
      type: String,
      required: true,
      trim: true,
    },
    constituency: {
      type: String,
      required: true,
      trim: true,
    },
    wardNumber: {
      type: String,
      required: true,
      trim: true,
    },

    corporatorCurrentParty: {
      type: String,
      required: true,
      trim: true,
    },

    previousWinningParty: {
      type: String,
      required: true,
      trim: true,
    },

    corporatorName: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const BmcMapping = mongoose.model("bmcmapping", BmcMappingSchema);

module.exports = BmcMapping;
