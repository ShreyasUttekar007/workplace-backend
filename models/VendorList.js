const mongoose = require("mongoose");

const VendorListSchema = new mongoose.Schema(
  {
    vendorLocation: {
      type: String,
      required: true,
      trim: true,
    },
    vendorName: {
      type: String,
      required: true,
      trim: true,
    },
    vendorNumber: {
      type: String,
      required: true,
      trim: true,
    },
    vendorGroupLink: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true, 
  }
);

const VendorList = mongoose.model("VendorList", VendorListSchema);

module.exports = VendorList;
