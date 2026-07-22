const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../config");
const mongoose = require('mongoose'); // Import mongoose
const User = require("../models/User");
const Booth = require('../models/BoothList');
const crypto = require("crypto");
const sgMail = require("@sendgrid/mail");
const PasswordReset = require("../models/PasswordReset");
require("dotenv").config();

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ---- Forgot-password settings ----
const OTP_LENGTH = 6;              // change to 4 if you prefer a 4-digit code
const OTP_TTL_MINUTES = 10;        // how long a code stays valid
const OTP_MAX_ATTEMPTS = 5;        // wrong tries before the code is burned
const RESEND_COOLDOWN_SECONDS = 60;
const RESET_TOKEN_TTL_MINUTES = 10;
// Must be a SendGrid-verified sender. Set MAIL_FROM in .env to override.
const MAIL_FROM = process.env.MAIL_FROM || "no-reply@showtimeconsulting.in";

// Never store the OTP/token itself — only a keyed hash of it.
const hashValue = (value) =>
  crypto.createHmac("sha256", config.jwtSecret).update(String(value)).digest("hex");

const generateOtp = () => {
  const max = 10 ** OTP_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(OTP_LENGTH, "0");
};

const otpEmailHtml = (userName, otp) => `
  <div style="font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f4f7fb;padding:32px">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;
                overflow:hidden;box-shadow:0 10px 30px rgba(16,42,76,.08)">
      <div style="background:#102a4c;padding:22px 28px;color:#fff">
        <div style="font-size:18px;font-weight:700;letter-spacing:.3px">STC Workplace</div>
      </div>
      <div style="padding:28px">
        <p style="margin:0 0 12px;color:#1b2b41;font-size:15px">
          Hi ${userName || "there"},
        </p>
        <p style="margin:0 0 20px;color:#48607d;font-size:14px;line-height:1.6">
          Use the verification code below to reset your STC Workplace password.
          This code expires in ${OTP_TTL_MINUTES} minutes.
        </p>
        <div style="text-align:center;margin:26px 0">
          <span style="display:inline-block;background:#eef4ff;color:#12376b;
                       font-size:30px;font-weight:700;letter-spacing:10px;
                       padding:16px 26px;border-radius:12px;border:1px solid #d5e3fb">
            ${otp}
          </span>
        </div>
        <p style="margin:0;color:#7d8ea3;font-size:12.5px;line-height:1.6">
          If you did not request a password reset, you can safely ignore this
          email — your password will stay unchanged. Please do not share this
          code with anyone.
        </p>
      </div>
    </div>
  </div>`;


const router = express.Router();

const { ObjectId } = mongoose.Types;

router.post("/signup", async (req, res, next) => {
  try {
    const { userName, email, password, roles, location } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }
    const user = new User({ userName, email, password, roles, location });
    await user.save();
    const token = jwt.sign({ userId: user._id }, config.jwtSecret, {
      expiresIn: "1d",
    });
    res.status(201).json({ message: "User created successfully", token });
  } catch (error) {
    next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { userName, email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    user.comparePassword(password, async function (err, isMatch) {
      if (err) {
        throw err;
      }

      if (!isMatch) {
        return res.status(401).json({ message: "Authentication failed" });
      }

      const token = jwt.sign({ userId: user._id }, config.jwtSecret, {
        expiresIn: "1d",
      });

      const userObj = {
        email: user.email,
        _id: user._id,
        roles: user.roles,
        userName: user.userName,
        empId: user.empId,
        location: user.location,
        stcCode: user.stcCode,
      };

      req.session.token = token;

      res.cookie("token", token, {
        maxAge: 36000000,
        sameSite: "none",
        secure: true,
        httpOnly: false,
      });

      res.status(200).json({ message: "Login success", userObj, token });
    });
  } catch (error) {
    next(error);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const users = await User.find({}, { password: 0 });
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
});

router.get("/users/:id", async (req, res, next) => {
  try {
    const userId = req.params.id;

    // Validate the userId
    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(userId, { password: 0 });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
});

router.put("/update-password", async (req, res, next) => {
  try {
    const { email, currentPassword, newPassword } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    user.comparePassword(currentPassword, async (err, isMatch) => {
      if (err) throw err;

      if (!isMatch) {
        return res
          .status(401)
          .json({ message: "Current password is incorrect" });
      }
      user.password = newPassword;

      await user.save();
      const newToken = jwt.sign({ userId: user._id }, config.jwtSecret, {
        expiresIn: "1d",
      });

      res
        .status(200)
        .json({ message: "Password updated successfully", newToken });
    });
  } catch (error) {
    next(error);
  }
});

router.put("/update-user/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const {
      email,
      userName,
      roles,
      location,
      reportingManagerEmail,
      reportingManagerName,
      secondaryReportingManagerEmail,
      secondaryReportingManagerName,
      department,
      team,
    } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.email = email || user.email;
    user.userName = userName || user.userName;
    user.roles = roles || user.roles;
    user.location = location || user.location;
    if (reportingManagerEmail !== undefined)
      user.reportingManagerEmail = reportingManagerEmail;
    if (reportingManagerName !== undefined)
      user.reportingManagerName = reportingManagerName;
    if (secondaryReportingManagerEmail !== undefined)
      user.secondaryReportingManagerEmail = secondaryReportingManagerEmail;
    if (secondaryReportingManagerName !== undefined)
      user.secondaryReportingManagerName = secondaryReportingManagerName;
    if (department !== undefined) user.department = department;
    if (team !== undefined) user.team = team;

    await user.save();
    res.status(200).json({ message: "User updated successfully" });
  } catch (error) {
    next(error);
  }
});


router.delete("/users/:id", async (req, res, next) => {
  try {
    const userId = req.params.id;
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    next(error);
  }
});

router.put("/update-usersss/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { email, roles, password } = req.body;

    // Validate the userId
    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Find the user by ID
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update user data
    if (email) user.email = email;
    if (roles) user.roles = roles;
    if (password) user.password = password; 

    // Save the updated user data
    await user.save();

    res.status(200).json({ message: "User updated successfully" });
  } catch (error) {
    next(error);
  }
});


/**
 * POST /api/auth/forgot-password  { email }
 * Always replies with the same generic message so this cannot be used to
 * discover which email addresses have accounts.
 */
router.post("/forgot-password", async (req, res) => {
  const generic = {
    message:
      "If an account exists for that email, a verification code has been sent.",
  };
  try {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email });
    if (!user) return res.status(200).json(generic);

    // Enforce the resend cooldown.
    const existing = await PasswordReset.findOne({ email });
    if (existing && existing.lastSentAt) {
      const since = (Date.now() - new Date(existing.lastSentAt).getTime()) / 1000;
      if (since < RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({
          message: `Please wait ${Math.ceil(
            RESEND_COOLDOWN_SECONDS - since
          )}s before requesting another code.`,
          retryAfter: Math.ceil(RESEND_COOLDOWN_SECONDS - since),
        });
      }
    }

    const otp = generateOtp();
    await PasswordReset.findOneAndUpdate(
      { email },
      {
        email,
        otpHash: hashValue(otp),
        resetTokenHash: "",
        attempts: 0,
        verified: false,
        lastSentAt: new Date(),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!process.env.SENDGRID_API_KEY) {
      console.error("forgot-password: SENDGRID_API_KEY missing; email not sent");
      return res
        .status(503)
        .json({ message: "Email service is not configured. Contact the admin." });
    }

    await sgMail.send({
      to: email,
      from: MAIL_FROM,
      subject: "Your STC Workplace verification code",
      text: `Your verification code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      html: otpEmailHtml(user.userName, otp),
    });

    return res.status(200).json(generic);
  } catch (error) {
    console.error(
      "forgot-password error:",
      (error && error.response && error.response.body) || error.message
    );
    return res
      .status(500)
      .json({ message: "Could not send the verification code. Try again." });
  }
});

/**
 * POST /api/auth/verify-otp  { email, otp }
 * On success returns a short-lived resetToken required by /reset-password.
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    const otp = String((req.body && req.body.otp) || "").trim();
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and code are required." });
    }

    const record = await PasswordReset.findOne({ email });
    if (!record || record.expiresAt < new Date()) {
      return res
        .status(400)
        .json({ message: "This code has expired. Please request a new one." });
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({
        message: "Too many incorrect attempts. Please request a new code.",
      });
    }
    if (record.otpHash !== hashValue(otp)) {
      record.attempts += 1;
      await record.save();
      const left = Math.max(0, OTP_MAX_ATTEMPTS - record.attempts);
      return res.status(400).json({
        message: left
          ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "Too many incorrect attempts. Please request a new code.",
        attemptsLeft: left,
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    record.verified = true;
    record.resetTokenHash = hashValue(resetToken);
    record.attempts = 0;
    record.expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    await record.save();

    return res.status(200).json({ message: "Code verified.", resetToken });
  } catch (error) {
    console.error("verify-otp error:", error.message);
    return res.status(500).json({ message: "Could not verify the code." });
  }
});

/**
 * POST /api/auth/reset-password  { email, resetToken, newPassword }
 * Assigns the password and calls save() so the User pre-save hook hashes it.
 */
router.post("/reset-password", async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    const resetToken = String((req.body && req.body.resetToken) || "").trim();
    const newPassword = String((req.body && req.body.newPassword) || "");

    if (!email || !resetToken || !newPassword) {
      return res.status(400).json({ message: "Missing required details." });
    }
    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters." });
    }

    const record = await PasswordReset.findOne({ email });
    if (
      !record ||
      !record.verified ||
      !record.resetTokenHash ||
      record.expiresAt < new Date() ||
      record.resetTokenHash !== hashValue(resetToken)
    ) {
      return res.status(400).json({
        message: "This reset session has expired. Please start again.",
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Account not found." });
    }

    // save() (not updateOne) so the pre-save hook hashes the new password.
    user.password = newPassword;
    await user.save();

    await PasswordReset.deleteOne({ _id: record._id });

    return res
      .status(200)
      .json({ message: "Password updated. You can sign in now." });
  } catch (error) {
    console.error("reset-password error:", error.message);
    return res.status(500).json({ message: "Could not reset the password." });
  }
});

module.exports = router;
