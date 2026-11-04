const mongoose = require("mongoose");

/** Who revealed which contact number in an AC proforma, and when. */
const ProformaAuditSchema = new mongoose.Schema(
  {
    email: { type: String, trim: true, index: true },
    ac: { type: String, trim: true, index: true },
    tab: { type: String, trim: true },
    person: { type: String, trim: true },
    ref: { type: String, trim: true },
    ip: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProformaAudit", ProformaAuditSchema);
