const express = require("express");
const router = express.Router();
const Leave = require("../models/LeaveRequest");
const { applyLeaveStatus } = require("../utils/leaveStatus");
const { sendActionSummary } = require("../utils/leaveEmails");

// NOTE: This router is intentionally NOT behind authenticateUser — it is reached
// by a reporting manager clicking a link in their email. Security comes from the
// per-request actionToken embedded in the link.

// ---- Animated confirmation page shown after a successful action ----
const resultPage = ({ title, message, accent, kind }) => {
  // kind: "approved" | "declined" | "info"
  const mark =
    kind === "declined"
      ? // cross
        `<svg class="mark" viewBox="0 0 52 52"><circle class="mark-circle" cx="26" cy="26" r="24"/><path class="mark-x1" d="M17 17 L35 35"/><path class="mark-x2" d="M35 17 L17 35"/></svg>`
      : kind === "info"
      ? `<svg class="mark" viewBox="0 0 52 52"><circle class="mark-circle" cx="26" cy="26" r="24"/><path class="mark-i" d="M26 16 v2 M26 24 v12"/></svg>`
      : // check
        `<svg class="mark" viewBox="0 0 52 52"><circle class="mark-circle" cx="26" cy="26" r="24"/><path class="mark-check" d="M16 27 L23 34 L37 19"/></svg>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body{margin:0;font-family:'Segoe UI',system-ui,Arial,sans-serif;
       background:linear-gradient(135deg,#eef3fb 0%,#e6eef9 100%);
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
  .card{background:#fff;border-radius:20px;box-shadow:0 24px 60px rgba(19,49,91,.16);
        padding:44px 40px 38px;max-width:460px;width:100%;text-align:center;
        animation:pop .45s cubic-bezier(.18,.89,.32,1.28) both;}
  @keyframes pop{from{opacity:0;transform:translateY(16px) scale(.96)}to{opacity:1;transform:none}}

  .mark{width:96px;height:96px;margin:0 auto 18px;display:block;}
  .mark-circle{fill:none;stroke:var(--accent);stroke-width:3;
       stroke-dasharray:151;stroke-dashoffset:151;
       animation:draw .6s ease forwards;}
  .mark-check{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;stroke-linejoin:round;
       stroke-dasharray:48;stroke-dashoffset:48;animation:draw .4s .5s ease forwards;}
  .mark-x1,.mark-x2{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;
       stroke-dasharray:26;stroke-dashoffset:26;}
  .mark-x1{animation:draw .3s .5s ease forwards;}
  .mark-x2{animation:draw .3s .75s ease forwards;}
  .mark-i{fill:none;stroke:var(--accent);stroke-width:4;stroke-linecap:round;
       stroke-dasharray:16;stroke-dashoffset:16;animation:draw .4s .5s ease forwards;}
  @keyframes draw{to{stroke-dashoffset:0}}

  /* gentle pulse ring behind the mark */
  .ring{position:relative;}
  .ring::after{content:"";position:absolute;left:50%;top:48px;width:96px;height:96px;
       border-radius:50%;transform:translate(-50%,-50%) scale(.4);
       background:var(--accent);opacity:.18;animation:ring 1.1s .35s ease-out forwards;}
  @keyframes ring{to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}

  h1{color:var(--accent);margin:0 0 12px;font-size:1.5rem;font-weight:800;letter-spacing:-.01em;}
  p{color:#3a4a5e;font-size:1.02rem;line-height:1.55;margin:0;}
  .sub{margin-top:16px;color:#8a97a8;font-size:.85rem;}
  .badge{display:inline-block;margin-top:18px;padding:7px 16px;border-radius:999px;
       background:rgba(0,0,0,.04);color:#5b6b80;font-size:.8rem;font-weight:600;}
</style></head>
<body>
  <div class="card">
    <div class="ring">${mark}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="sub">STC Workplace · You can close this window.</div>
  </div>
</body></html>`;
};

const errorPage = (title, message) =>
  resultPage({ title, message, accent: "#b00020", kind: "info" });

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const { action, token } = req.query;

  try {
    const leaveRequest = await Leave.findById(id);
    if (!leaveRequest) {
      return res
        .status(404)
        .send(errorPage("Not found", "This leave request no longer exists."));
    }

    if (!token || token !== leaveRequest.actionToken) {
      return res
        .status(403)
        .send(
          errorPage(
            "Invalid link",
            "This action link is invalid or has expired. Please action the request from the portal."
          )
        );
    }

    const target =
      action === "approve"
        ? "approved"
        : action === "decline"
        ? "not approved"
        : null;
    if (!target) {
      return res
        .status(400)
        .send(errorPage("Invalid action", "Unknown action requested."));
    }

    // Already actioned (by portal or a previous click) — friendly notice, no double-send.
    if (leaveRequest.leaveStatus && leaveRequest.leaveStatus !== "pending") {
      const already =
        leaveRequest.leaveStatus === "approved" ? "approved" : leaveRequest.leaveStatus;
      return res.send(
        resultPage({
          title: "Already actioned",
          message: `This request (${leaveRequest.leaveCode}) is already marked <b>${already}</b>. No further action is needed.`,
          accent: "#5b6b80",
          kind: "info",
        })
      );
    }

    const result = await applyLeaveStatus(leaveRequest, target);

    // Notify the secondary reporting manager(s) + applicant + portal with a summary.
    if (result.status !== "unchanged") {
      await sendActionSummary(leaveRequest, target);
    }

    // Animated acknowledgement for the primary reporting manager.
    if (target === "approved") {
      return res.send(
        resultPage({
          title: "Approval Recorded",
          message:
            "Your action has been considered and the same will reflect on the portal. " +
            "Thank you — the request has been <b>approved</b>.",
          accent: "#1f8a4c",
          kind: "approved",
        })
      );
    }
    return res.send(
      resultPage({
        title: "Decision Recorded",
        message:
          "Your action has been considered and the same will reflect on the portal. " +
          "The request has been marked <b>not approved</b>.",
        accent: "#b00020",
        kind: "declined",
      })
    );
  } catch (e) {
    if (e.code === "NO_EMPLOYEE") {
      return res
        .status(404)
        .send(
          errorPage(
            "Employee not found",
            "Could not find the employee's leave balance to update. Please action this from the portal."
          )
        );
    }
    return res
      .status(500)
      .send(
        errorPage(
          "Something went wrong",
          "We couldn't complete this action. Please action the request from the portal."
        )
      );
  }
});

module.exports = router;
