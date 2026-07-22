const mongoose = require("mongoose");
const { Schema } = mongoose;

/**
 * Short-lived password-reset requests.
 * The OTP is never stored in plain text — only an HMAC hash of it.
 * Mongo removes each document automatically once `expiresAt` passes.
 */
const PasswordResetSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    otpHash: { type: String, required: true },
    // Issued only after the OTP is verified; required to set a new password.
    resetTokenHash: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    lastSentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index — the document self-destructs at expiresAt.
PasswordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PasswordReset", PasswordResetSchema);
