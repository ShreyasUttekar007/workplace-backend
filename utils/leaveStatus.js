const EmployeeLeave = require("../models/EmployeeData");

/**
 * Apply a leave status transition, adjusting the employee's leave balance
 * when (and only when) a request moves into "approved" from a non-approved
 * state. Guards against double-application.
 *
 * Returns { status: "unchanged" | "updated" | "approved", leaveRequest }.
 * Throws an Error with .code = "NO_EMPLOYEE" or "INVALID_TYPE" on failure.
 */
async function applyLeaveStatus(leaveRequest, leaveStatus) {
  const prev = leaveRequest.leaveStatus;

  if (prev === leaveStatus) {
    return { status: "unchanged", leaveRequest };
  }

  // Non-approval transitions: just set the status, no balance change.
  if (leaveStatus !== "approved") {
    leaveRequest.leaveStatus = leaveStatus;
    await leaveRequest.save();
    return { status: "updated", leaveRequest };
  }

  // Approving: deduct balance only when coming from a non-approved state.
  const employee = await EmployeeLeave.findOne({
    employeeEmail: { $regex: new RegExp(`^${leaveRequest.email}$`, "i") },
  });
  if (!employee) {
    const err = new Error("Employee not found");
    err.code = "NO_EMPLOYEE";
    throw err;
  }

  const startDate = new Date(leaveRequest.startDate);
  const endDate = new Date(leaveRequest.endDate);
  const leaveDays =
    Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

  switch (leaveRequest.leaveType) {
    case "paidLeave":
      if (employee.paidLeave >= leaveDays) {
        employee.paidLeave -= leaveDays;
      } else {
        const remainingDays = leaveDays - employee.paidLeave;
        employee.paidLeave = 0;
        if (employee.sickLeave >= remainingDays) {
          employee.sickLeave -= remainingDays;
        } else {
          const extraNeeded = remainingDays - employee.sickLeave;
          employee.sickLeave = 0;
          employee.paidLeave -= extraNeeded;
        }
      }
      break;
    case "sickLeave":
      if (employee.sickLeave >= leaveDays) {
        employee.sickLeave -= leaveDays;
      } else {
        const remainingDays = leaveDays - employee.sickLeave;
        employee.sickLeave = 0;
        if (employee.paidLeave >= remainingDays) {
          employee.paidLeave -= remainingDays;
        } else {
          const extraNeeded = remainingDays - employee.paidLeave;
          employee.paidLeave = 0;
          employee.sickLeave -= extraNeeded;
        }
      }
      break;
    case "restrictedHoliday":
      employee.restrictedHoliday -= leaveDays;
      break;
    case "menstrualLeave":
      employee.menstrualLeave -= leaveDays;
      break;
    case "halfDayLeave":
      employee.paidLeave -= 0.5;
      break;
    case "regularizationLeave":
      employee.regularizationLeave -= leaveDays;
      break;
    case "compensationLeave":
      employee.compensationLeave =
        Number(employee.compensationLeave || 0) + leaveDays;
      break;
    case "onOfficeDuty":
      employee.onOfficeDuty = Number(employee.onOfficeDuty || 0) + leaveDays;
      break;
    default: {
      const err = new Error("Invalid leave type");
      err.code = "INVALID_TYPE";
      throw err;
    }
  }

  await employee.save();
  leaveRequest.leaveStatus = "approved";
  await leaveRequest.save();
  return { status: "approved", leaveRequest };
}

module.exports = { applyLeaveStatus };
