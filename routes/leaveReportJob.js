const cron = require("node-cron");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const sgMail = require("@sendgrid/mail");
const LeaveRequest = require("../models/LeaveRequest"); // Adjust based on your model path
require("dotenv").config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const generatePDF = (leaveData) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 20,
    });
    const filePath = path.join(__dirname, "leave_report.pdf");
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    // Title
    doc
      .fontSize(18)
      .text("Daily Leave Report", { align: "center", underline: true });
    doc.moveDown(2);

    if (leaveData.length === 0) {
      doc
        .fontSize(14)
        .text("No employees are on leave today.", { align: "center" });
      doc.end();
      writeStream.on("finish", () => resolve(filePath));
      writeStream.on("error", reject);
      return;
    }

    doc.fontSize(14).text(`Total Employees on Leave: ${leaveData.length}`);
    doc.moveDown(2);

    // Table Headers
    // Table Headers
    const headers = [
      "#",
      "Name",
      "Emp Code",
      "Department",
      "Manager",
      "Leave Type",
      "Reason",
    ];
    const columnWidths = [40, 100, 80, 80, 100, 100, 300]; // Adjusted for better fit
    let y = doc.y + 10;

    doc.fillColor("black");

    headers.forEach((header, i) => {
      const xPos = 30 + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

      // Draw the header background
      doc.rect(xPos, y - 2, columnWidths[i], 30).fill("#87CEEB"); // Light Blue Header

      // Draw the border for the header
      doc.rect(xPos, y - 2, columnWidths[i], 30).stroke();

      // Add text
      doc
        .fillColor("black")
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(header, xPos + 5, y + 7, {
          width: columnWidths[i] - 10,
          align: "left",
        });
    });

    y += 35;
    doc.fillColor("black");

    leaveData.forEach((leave, index) => {
      const rowHeight = 50;
      const values = [
        index + 1,
        leave.name,
        leave.employeeCode,
        leave.department || "N/A",
        leave.receiverName || "N/A",
        leave.leaveType,
        leave.reasonForLeave || "N/A",
      ];

      values.forEach((value, i) => {
        const xPos = 30 + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc
          .font("Helvetica")
          .fontSize(11)
          .text(value, xPos + 5, y + 10, {
            width: columnWidths[i] - 10,
            align: "left",
            ellipsis: true,
          });
        doc.rect(xPos, y - 2, columnWidths[i], rowHeight).stroke();
      });

      y += rowHeight;
    });

    doc.end();
    writeStream.on("finish", () => resolve(filePath));
    writeStream.on("error", reject);
  });
};

const sendEmailWithPDF = async (filePath, leaveData) => {
  const recipients = [
    "anurag@showtimeconsulting.in",
    "saumitra@showtimeconsulting.in",
    "stc.portal@showtimeconsulting.in",
  ];
  const emailContent = leaveData.length
    ? `Attached is the daily leave report. Total Employees on Leave: ${leaveData.length}`
    : "No employees are on leave today.";

  const msg = {
    to: recipients,
    from: "stc.portal@showtimeconsulting.in",
    subject: "Daily Leave Report",
    text: emailContent,
    attachments: [
      {
        content: fs.readFileSync(filePath).toString("base64"),
        filename: "leave_report.pdf",
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  };

  await sgMail.send(msg);
};

const fetchAndSendLeaveReport = async () => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const leaveData = await LeaveRequest.find({
      startDate: { $lte: today },
      endDate: { $gte: today },
    });

    const pdfPath = await generatePDF(leaveData);
    await sendEmailWithPDF(pdfPath, leaveData);

    console.log("Daily leave report sent successfully!");
  } catch (error) {
    console.error("Error sending leave report:", error);
  }
};

cron.schedule("10 11 * * *", fetchAndSendLeaveReport, {
  timezone: "Asia/Kolkata",
});

module.exports = fetchAndSendLeaveReport;
