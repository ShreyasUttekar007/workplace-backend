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

    const headers = [
      "#",
      "Name",
      "Emp Code",
      "Department",
      "Manager",
      "Leave Type",
      "From",
      "To",
      "Status", // New column
    ];

    // Adjusted column widths to fit landscape A4
    const columnWidths = [30, 90, 70, 90, 90, 70, 90, 90, 70];
    const maxRowsPerPage = 7; // Adjust for better layout
    let y = doc.y + 10;
    let currentRow = 0;

    const formatDate = (dateString) => {
      if (!dateString) return "N/A";
      const date = new Date(dateString);
      return date.toLocaleDateString("en-GB"); // formats as DD/MM/YYYY
    };

    const drawTableHeaders = () => {
      y = doc.y + 10;
      headers.forEach((header, i) => {
        const xPos = 30 + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);
        doc
          .rect(xPos, y - 2, columnWidths[i], 30)
          .fill("#87CEEB")
          .stroke();
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
    };

    drawTableHeaders();

    leaveData.forEach((leave, index) => {
      if (currentRow >= maxRowsPerPage) {
        doc.addPage();
        drawTableHeaders();
        currentRow = 0;
      }

      const rowHeight = 50;
      const values = [
        index + 1,
        leave.name,
        leave.employeeCode,
        leave.department || "N/A",
        leave.receiverName || "N/A",
        leave.leaveType,
        formatDate(leave.startDate),
        formatDate(leave.endDate),
        leave.leaveStatus || "N/A",
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
      currentRow++;
    });

    doc.end();
    writeStream.on("finish", () => resolve(filePath));
    writeStream.on("error", reject);
  });
};

const sendEmailWithPDF = async (filePath, leaveData) => {
  const recipients = [
    "miteshbhadane@showtimeconsulting.in",
    "prasad.p@showtimeconsulting.in",
    "chaithanya.durge@showtimeconsulting.in",
  ];
  const emailContent = leaveData.length
    ? `Attached is the daily leave report. Total Employees on Leave: ${leaveData.length}`
    : "No employees are on leave today.";

  // Read attachment only once
  const attachmentContent = fs.readFileSync(filePath).toString("base64");

  for (const toEmail of recipients) {
    const msg = {
      to: toEmail,
      from: "stc.portal@showtimeconsulting.in",
      subject: "Daily Leave Report",
      text: emailContent,
      attachments: [
        {
          content: attachmentContent,
          filename: "leave_report.pdf",
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    };
    try {
      await sgMail.send(msg);
      console.log(`Email sent to ${toEmail}`);
    } catch (err) {
      console.error(`Failed to send to ${toEmail}:`, err.message);
    }
  }
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

cron.schedule("00 18 * * *", fetchAndSendLeaveReport, {
  timezone: "Asia/Kolkata",
});

module.exports = fetchAndSendLeaveReport;
