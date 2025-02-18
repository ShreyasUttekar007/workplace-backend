const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const jwt = require("jsonwebtoken");
const config = require("./config");
const authMiddleware = require("./middleware/authMiddleware");
const errorHandler = require("./middleware/errorHandler");
const authRoutes = require("./routes/auth");
const momRoutes = require("./routes/mom");
const reportRoutes = require("./routes/report");
const form17Routes = require("./routes/form17");
const form20Routes = require("./routes/form20");
const casteRoutes = require("./routes/caste");
const gattRoutes = require("./routes/gatt");
const mediaRoutes = require("./routes/mediaScan");
const boothRoutes = require("./routes/boothList");
const idiRoutes = require("./routes/idi");
const candidateRoutes = require("./routes/candidateList");
const leaveRoutes = require("./routes/leaveRequest");
const employeeRoutes = require("./routes/employeeData");
const empRoutes = require("./routes/empMetrics");
const bmcMappingRoutes = require("./routes/bmcMapping");
const stateMappingRoutes = require("./routes/stateMapping");
const travelRoutes = require("./routes/travelRecords");
const holidayRoutes = require("./routes/mahaHolidayCalendar");
const cabRoutes = require("./routes/cabRequests");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const MongoDBStore = require("connect-mongodb-session")(session);
const app = express();
require("./routes/leaveReportJob"); // Import and execute the cron job


app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);

app.all("*", function (req, res, next) {
  res.header("Access-Control-Allow-Origin", process.env.CORS_ORIGIN);
  res.header("Access-Control-Allow-Credentials", true);
  res.header("Access-Control-Expose-Headers", "*");
  res.header("Access-Control-Allow-Methods", "PUT, GET, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Access-Control-Allow-Origin, Access-Control-Expose-Headers"
  );
  next();
});
mongoose
  .connect(config.mongodbURI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((error) => {
    console.log("Error connecting to MongoDB:", error);
  });

const store = new MongoDBStore({
  uri: process.env.MONGODB_URI,
  collection: "sessions",
});

app.use(
  session({
    secret: "iuZeL0LrnkO5K$edr3RWD!S!q",
    resave: false,
    saveUninitialized: false,
    store: store,
    cookie: {
      maxAge: 36000000, //3600000ms = 1hr
      sameSite: "none",
      secure: true,
    },
  })
);

app.use(bodyParser.json());
app.use(morgan("dev"));
app.use(cookieParser());

app.use(authMiddleware);

app.use(errorHandler);

app.use("/api/auth", authRoutes);
app.use("/api/moms", momRoutes);
app.use("/api/report", reportRoutes);
app.use("/api/form17", form17Routes);
app.use("/api/form20", form20Routes);
app.use("/api/gatt", gattRoutes);
app.use("/api/caste", casteRoutes);
app.use("/api/mediascan", mediaRoutes);
app.use("/api/booth", boothRoutes);
app.use("/api/idi", idiRoutes);
app.use("/api/candidate", candidateRoutes);
app.use("/api/empmetrics", empRoutes);
app.use("/api/leavedata", leaveRoutes);
app.use("/api/employeedata", employeeRoutes);
app.use("/api/bmc", bmcMappingRoutes);
app.use("/api/state", stateMappingRoutes);
app.use("/api/travel", travelRoutes);
app.use("/api/holiday", holidayRoutes);
app.use("/api/cab", cabRoutes);


if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "client/build")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "client/build/index.html"));
  });
}

// Start server
const port = process.env.PORT || 5000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
