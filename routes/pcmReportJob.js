const cron = require("node-cron");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const sgMail = require("@sendgrid/mail");
const PcmReport = require("../models/PcmReport");
require("dotenv").config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const RECIPIENTS = [
  "pardhasaradhi@showtimeconsulting.in",
  "alimpan@showtimeconsulting.in",
  "aditya.pandit@showtimeconsulting.in",
];
const FROM = "stc.portal@showtimeconsulting.in";

const fmtDateDDMMYYYY = (d) => {
  const dt = d ? new Date(d) : new Date();
  return dt.toLocaleDateString("en-GB"); // DD/MM/YYYY
};

const generatePDF = (report, dateLabel) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
    const filePath = path.join(__dirname, "pcm_report.pdf");
    const ws = fs.createWriteStream(filePath);
    doc.pipe(ws);

    const AMBER = "#FAD464";
    const MAROON = "#660000";
    const pageW = doc.page.width;
    const left = 24;
    const usableW = pageW - 48;

    // Title
    doc
      .fillColor(MAROON)
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("PCM Activity & Attendance Report", { align: "center" });
    doc
      .fillColor("#333")
      .font("Helvetica")
      .fontSize(11)
      .text(dateLabel, { align: "center" });
    doc.moveDown(0.8);

    const snap = (report && report.snapshot) || {};
    // Snapshot grid (3 columns x 3 rows of label:value)
    const snapItems = [
      ["Total No of PCMs", snap.totalPcms],
      ["PCMs Present", snap.pcmsPresent],
      ["PCMs Absent", snap.pcmsAbsent],
      ["Vacant PCs", snap.vacantPcs],
      ["Zonals Present", snap.zonalsPresent],
      ["Zonals Absent", snap.zonalsAbsent],
      ["Total Meetings Scheduled", snap.meetingsScheduled],
      ["Cab issues PCs", snap.cabIssuesPcs],
      ["Total Escalations", snap.totalEscalations],
    ];
    doc.fillColor(MAROON).font("Helvetica-Bold").fontSize(12)
      .text("Snapshot of PCM Activity & Attendance", left, doc.y);
    doc.moveDown(0.3);
    let sy = doc.y;
    const colW = usableW / 3;
    snapItems.forEach((it, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = left + col * colW;
      const y = sy + row * 26;
      doc.rect(x, y, colW - 6, 24).fill(AMBER).stroke();
      doc.fillColor("#000").font("Helvetica-Bold").fontSize(9)
        .text(`${it[0]}:`, x + 5, y + 4, { width: colW - 70, continued: false });
      doc.fillColor("#000").font("Helvetica").fontSize(11)
        .text(it[1] == null ? "-" : String(it[1]), x + colW - 60, y + 5, {
          width: 50, align: "right",
        });
    });
    doc.y = sy + 3 * 26 + 10;

    // PCM Activity table
    doc.fillColor(MAROON).font("Helvetica-Bold").fontSize(12)
      .text(`PCM Activity Report - ${dateLabel}`, left, doc.y);
    doc.moveDown(0.3);

    const headers = ["#", "PCM Name", "PC Mapped", "Att.", "Cab", "Esc.", "Opp.", "Meeting Conducted / Note"];
    const widths = [22, 95, 90, 45, 35, 32, 32, usableW - (22 + 95 + 90 + 45 + 35 + 32 + 32)];
    const rows = (report && report.pcmRows) || [];

    const drawHeader = () => {
      let y = doc.y;
      headers.forEach((h, i) => {
        const x = left + widths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.rect(x, y, widths[i], 20).fill(AMBER).stroke();
        doc.fillColor("#000").font("Helvetica-Bold").fontSize(8)
          .text(h, x + 3, y + 6, { width: widths[i] - 6 });
      });
      doc.y = y + 20;
    };
    drawHeader();

    rows.forEach((r, idx) => {
      const meeting = [r.meetingConducted, r.note].filter(Boolean).join(" | ");
      const vals = [
        r.slNo || idx + 1,
        r.pcmName || "",
        r.pcMapped || "",
        r.attendance || "",
        r.cabUsed || "",
        r.escalationRaised || "0",
        r.oppositionRaised || "0",
        meeting || "",
      ];
      // estimate row height from the long last column
      const mh = doc.heightOfString(vals[7], { width: widths[7] - 6, fontSize: 8 });
      const rowH = Math.max(20, mh + 8);
      if (doc.y + rowH > doc.page.height - 30) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      vals.forEach((v, i) => {
        const x = left + widths.slice(0, i).reduce((a, b) => a + b, 0);
        doc.rect(x, y, widths[i], rowH).stroke();
        doc.fillColor("#000").font("Helvetica").fontSize(8)
          .text(String(v), x + 3, y + 4, { width: widths[i] - 6 });
      });
      doc.y = y + rowH;
    });

    // Zonal tracker
    const zrows = (report && report.zonalRows) || [];
    if (zrows.length) {
      doc.moveDown(0.6);
      if (doc.y > doc.page.height - 80) doc.addPage();
      doc.fillColor(MAROON).font("Helvetica-Bold").fontSize(12)
        .text("Zonal Activity Tracker", left, doc.y);
      doc.moveDown(0.3);
      const zh = ["#", "Zone", "PCs Mapped", "Zonal", "Meetings Conducted"];
      const zw = [22, 70, 150, 110, usableW - (22 + 70 + 150 + 110)];
      const drawZH = () => {
        let y = doc.y;
        zh.forEach((h, i) => {
          const x = left + zw.slice(0, i).reduce((a, b) => a + b, 0);
          doc.rect(x, y, zw[i], 20).fill(AMBER).stroke();
          doc.fillColor("#000").font("Helvetica-Bold").fontSize(8).text(h, x + 3, y + 6, { width: zw[i] - 6 });
        });
        doc.y = y + 20;
      };
      drawZH();
      zrows.forEach((r, idx) => {
        const vals = [r.slNo || idx + 1, r.zone || "", r.pcsMapped || "", r.zonal || "", r.meetingsConducted || ""];
        const mh = doc.heightOfString(String(vals[4]), { width: zw[4] - 6, fontSize: 8 });
        const rowH = Math.max(20, mh + 8);
        if (doc.y + rowH > doc.page.height - 30) { doc.addPage(); drawZH(); }
        const y = doc.y;
        vals.forEach((v, i) => {
          const x = left + zw.slice(0, i).reduce((a, b) => a + b, 0);
          doc.rect(x, y, zw[i], rowH).stroke();
          doc.fillColor("#000").font("Helvetica").fontSize(8).text(String(v), x + 3, y + 4, { width: zw[i] - 6 });
        });
        doc.y = y + rowH;
      });
    }

    // Note
    if (report && report.note) {
      doc.moveDown(0.6);
      if (doc.y > doc.page.height - 60) doc.addPage();
      doc.fillColor(MAROON).font("Helvetica-Bold").fontSize(11).text("Note:", left, doc.y);
      doc.fillColor("#000").font("Helvetica").fontSize(9).text(report.note, { width: usableW });
    }

    doc.end();
    ws.on("finish", () => resolve(filePath));
    ws.on("error", reject);
  });
};

const sendPcmReport = async () => {
  const date = new Date().toISOString().split("T")[0];
  const dateLabel = fmtDateDDMMYYYY(date);
  const report = await PcmReport.findOne({ date });

  const pdfPath = await generatePDF(report, dateLabel);
  const attachment = fs.readFileSync(pdfPath).toString("base64");
  const body = `PCM Activity & Attendance Report- ${dateLabel}`;

  for (const to of RECIPIENTS) {
    const msg = {
      to,
      from: FROM,
      subject: `PCM Activity & Attendance Report - ${dateLabel}`,
      text: body,
      attachments: [
        {
          content: attachment,
          filename: `PCM_Activity_Report_${date}.pdf`,
          type: "application/pdf",
          disposition: "attachment",
        },
      ],
    };
    try {
      await sgMail.send(msg);
      console.log(`PCM report sent to ${to}`);
    } catch (err) {
      console.error(`Failed to send PCM report to ${to}:`, err.message);
    }
  }
};

// Every day at 8:00 PM IST
cron.schedule("0 20 * * *", sendPcmReport, { timezone: "Asia/Kolkata" });

module.exports = { sendPcmReport };
