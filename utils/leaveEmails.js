const sgMail = require("@sendgrid/mail");
require("dotenv").config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM = "stc.portal@showtimeconsulting.in";
const PORTAL = "stc.portal@showtimeconsulting.in";

const isValidEmail = (e) =>
  typeof e === "string" &&
  e.trim().length > 0 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

const fmt = (d) => {
  try {
    return new Date(d).toLocaleDateString("en-GB");
  } catch (e) {
    return d;
  }
};

/**
 * Send a summary email (NO action buttons) after the primary reporting manager
 * has actioned a request. Goes to the secondary reporting manager(s), the
 * applicant, and the portal. Safe to call more than once — callers guard.
 */
async function sendActionSummary(leave, outcome) {
  const label = outcome === "approved" ? "Approved" : "Not Approved";
  const color = outcome === "approved" ? "#1f8a4c" : "#b00020";

  const set = new Set();
  [
    leave.reportingManagerEmail1,
    leave.reportingManagerEmail2,
    leave.reportingManagerEmail3,
    leave.reportingManagerEmail, // primary, as a record copy
    leave.email, // the applicant
    PORTAL,
  ].forEach((e) => {
    if (isValidEmail(e)) set.add(e.trim());
  });

  const to = [...set];
  if (!to.length) return;

  const subject = `Leave ${label} :: ${leave.name} :: ${leave.leaveCode}`;
  const text = `Leave request ${leave.leaveCode} from ${leave.name} (${leave.leaveType}, ${fmt(
    leave.startDate
  )} to ${fmt(
    leave.endDate
  )}) has been ${label} by the primary reporting manager. This is reflected on the STC Workplace portal.`;
  const html = `
    <p>Hello,</p>
    <p>
      This is a summary update on a leave request.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;color:#3a4a5e;">
      <tr><td style="padding:2px 14px 2px 0;"><strong>Employee</strong></td><td>${leave.name}</td></tr>
      <tr><td style="padding:2px 14px 2px 0;"><strong>Leave Code</strong></td><td>${leave.leaveCode}</td></tr>
      <tr><td style="padding:2px 14px 2px 0;"><strong>Type</strong></td><td>${leave.leaveType}</td></tr>
      <tr><td style="padding:2px 14px 2px 0;"><strong>Duration</strong></td><td>${fmt(leave.startDate)} to ${fmt(leave.endDate)}</td></tr>
      <tr><td style="padding:2px 14px 2px 0;"><strong>Decision</strong></td>
          <td><span style="color:${color};font-weight:700;">${label}</span></td></tr>
    </table>
    <p style="margin-top:14px;">
      The decision was taken by the primary reporting manager and is now reflected on the STC Workplace portal.
    </p>
    <p style="color:#8a97a8;font-size:12px;">This is an automated summary. No action is required from you.</p>
  `;

  try {
    await sgMail.send({ to, from: FROM, subject, text, html });
    console.log(`Leave summary (${label}) sent to:`, to);
  } catch (e) {
    console.error("Failed to send leave summary email:", e.message);
  }
}

module.exports = { sendActionSummary };
