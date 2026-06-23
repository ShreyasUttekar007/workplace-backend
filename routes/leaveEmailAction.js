const express = require("express");
const router = express.Router();
const Leave = require("../models/LeaveRequest");
const { applyLeaveStatus } = require("../utils/leaveStatus");
const { sendActionSummary } = require("../utils/leaveEmails");

// NOTE: This router is intentionally NOT behind authenticateUser — it is reached
// by a reporting manager clicking a link in their email. Security comes from the
// per-request actionToken embedded in the link.
//
// On a successful action we return HTTP 204 No Content (no visible web page), so
// the manager's click registers the decision without opening a portal/page.
// Only genuine error states (bad/expired link) render a small message.

const errorPage = (title, message) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:#eef2f7;
       display:flex;align-items:center;justify-content:center;min-height:100vh;}
  .card{background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(19,49,91,.14);
        padding:36px 40px;max-width:460px;text-align:center;}
  h1{color:#b00020;margin:0 0 10px;font-size:1.3rem;}
  p{color:#3a4a5e;font-size:1rem;line-height:1.5;margin:0;}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;

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

    // Already actioned (by portal or a previous click) -> silent 204, no double-send.
    if (leaveRequest.leaveStatus && leaveRequest.leaveStatus !== "pending") {
      return res.status(204).end();
    }

    const result = await applyLeaveStatus(leaveRequest, target);

    // Notify the secondary reporting manager(s) + applicant + portal with a summary.
    if (result.status !== "unchanged") {
      await sendActionSummary(leaveRequest, target);
    }

    // Success: no web page — the decision is final and reflected on the portal.
    return res.status(204).end();
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
