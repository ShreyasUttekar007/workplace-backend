const jwt = require("jsonwebtoken");
const config = require("../config");
const User = require("../models/User");

// Sign-in tokens last JWT_EXPIRES_IN (default 30 days).
// Sliding renewal: any request made with a token older than REFRESH_AFTER_SEC
// gets a brand-new token back in the "X-Refreshed-Token" response header; the
// frontend (utils/axiosConfig.js) stores it. Anyone who opens the portal at
// least once a month therefore stays signed in.
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "30d";
const REFRESH_AFTER_SEC = 24 * 60 * 60; // renew tokens older than 1 day

const authenticateUser = async (req, res, next) => {
  const header = req.header("Authorization");

  if (!header) {
    return res.status(401).json({ message: "Unauthorized - Missing token" });
  }

  let user;
  let decoded;
  try {
    decoded = jwt.verify(header.replace(/^Bearer\s+/i, "").trim(), config.jwtSecret);
    user = await User.findById(decoded.userId);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Unauthorized - Token expired" });
    }
    return res.status(401).json({ message: "Unauthorized - Invalid token" });
  }

  if (!user) {
    return res.status(401).json({ message: "Unauthorized - User not found" });
  }

  req.user = user;

  const now = Math.floor(Date.now() / 1000);
  if (decoded.iat && now - decoded.iat > REFRESH_AFTER_SEC) {
    try {
      const fresh = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: EXPIRES_IN });
      res.setHeader("X-Refreshed-Token", fresh);
    } catch (e) {
      // renewal is best-effort; the current token is still valid
    }
  }

  next();
};

module.exports = authenticateUser;
