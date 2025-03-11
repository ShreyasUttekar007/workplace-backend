const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../config");
const mongoose = require('mongoose'); // Import mongoose
const User = require("../models/User");
const Booth = require('../models/BoothList');

const router = express.Router();

const { ObjectId } = mongoose.Types;

router.post("/signup", async (req, res, next) => {
  try {
    const { userName, email, password, roles } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }
    const user = new User({ userName, email, password, roles });
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
    const { email, userName, roles } = req.body;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.email = email || user.email;
    user.userName = userName || user.userName;
    user.roles = roles || user.roles;

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

module.exports = router;
