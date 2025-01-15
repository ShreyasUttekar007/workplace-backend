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
  },
  {
    timestamps: true, 
  }
);

const BmcMapping = mongoose.model("bmcmapping", BmcMappingSchema);

module.exports = BmcMapping;
