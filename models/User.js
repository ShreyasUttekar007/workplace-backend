const mongoose = require("mongoose");
const { Schema } = mongoose;
const bcrypt = require("bcrypt");
const {
  zoneRoles,
  districtRoles,
  assemblyConstituencies,
  parliamentaryConstituencyRoles,
  zoneRolesAp,
  districtRolesAp,
  parliamentaryConstituencyRolesAp,
  assemblyConstituenciesAp,
  zoneRolesBg,
  districtRolesBg,
  parliamentaryConstituencyRolesBg,
  assemblyConstituenciesBg,
} = require("../models/roles");

const UserSchema = new Schema(
  {
    userName: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      trim: true,
      minlength: 6,
    },
    empId: {
      type: String,
    },
    location: {
      type: String,
    },
    stcCode: {
      type: String,
    },
    roles: {
      type: [
        {
          type: String,
          enum: [
            "admin",
            "mod",
            "user",
            "state",
            ...zoneRoles,
            ...assemblyConstituencies,
            ...districtRoles,
            ...parliamentaryConstituencyRoles,
            ...zoneRolesAp,
            ...districtRolesAp,
            ...parliamentaryConstituencyRolesAp,
            ...assemblyConstituenciesAp,
            ...zoneRolesBg,
            ...districtRolesBg,
            ...parliamentaryConstituencyRolesBg,
            ...assemblyConstituenciesBg,
          ],
        },
      ],
      default: ["user"],
    },
  },
  { timestamps: true }
);

UserSchema.pre("save", function (next) {
  const user = this;
  if (!user.isModified("password")) return next();
  bcrypt.genSalt(10, function (err, salt) {
    if (err) return next(err);
    bcrypt.hash(user.password, salt, function (err, hash) {
      if (err) return next(err);
      user.password = hash;
      next();
    });
  });
});

// Compares the password entered with the hash stored in the database
UserSchema.methods.comparePassword = function (candidatePassword, next) {
  bcrypt.compare(candidatePassword, this.password, function (err, isMatch) {
    if (err) return next(err);
    next(null, isMatch);
  });
};

const User = mongoose.model("User", UserSchema);

module.exports = User;
