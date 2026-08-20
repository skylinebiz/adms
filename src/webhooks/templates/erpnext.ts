import { WebhookTemplate } from "./types";

// ERPNext / Frappe HR's push API for attendance devices - logs each punch
// as an Employee Checkin. Confirmed against the official docs:
// https://docs.frappe.io/erpnext/integrating-erpnext-with-biometric-attendance-devices
//
// Endpoint app name varies by version: newer ERPNext (v14+) moved the HR
// module into a separate "hrms" app, older versions still serve it under
// "erpnext". Defaults to "hrms" (the current version) below; helpText
// tells the user to swap it for "erpnext" if their site predates the split.
export const erpnextEmployeeCheckin: WebhookTemplate = {
  id: "erpnext_employee_checkin",
  name: "ERPNext / Frappe HR — Employee Checkin",
  description: "Logs every punch as an Employee Checkin via ERPNext's add_log_based_on_employee_field API.",
  urlPlaceholder:
    "https://YOUR-SITE.erpnext.com/api/method/hrms.hr.doctype.employee_checkin.employee_checkin.add_log_based_on_employee_field",
  headers: {
    // Frappe's standard REST API token auth - not Bearer, not Basic.
    // https://docs.frappe.io/framework/user/en/guides/integration/rest_api/token_based_authentication
    Authorization: "token YOUR_API_KEY:YOUR_API_SECRET",
  },
  bodyTemplate: {
    // Matched against each Employee's "Attendance Device ID" field in
    // ERPNext by default (employee_fieldname, not included here) - set
    // that field to this device's PIN values, not the ERPNext employee ID.
    employee_field_value: "{{pin}}",
    // Frappe expects a naive "YYYY-MM-DD HH:mm:ss.ffffff" string, not
    // ISO8601 - see punch_time_frappe in src/webhooks/template.ts.
    timestamp: "{{punch_time_frappe}}",
    device_id: "{{device_serial}}",
    // Blank lets ERPNext infer IN/OUT by alternating - log_type is a
    // Select field limited to blank/"IN"/"OUT", so "Auto" (the old
    // default here) was rejected. Set to "IN"/"OUT" if you know this
    // device's convention.
    log_type: "",
  },
  helpText:
    'Replace "YOUR-SITE", "YOUR_API_KEY", and "YOUR_API_SECRET" above with your real values. ' +
    "Generate an API Key/Secret in ERPNext under your user → Settings → API Access → Generate Keys. " +
    'If your ERPNext version predates the separate HRMS app, change "hrms" to "erpnext" in the URL. ' +
    'employee_field_value must match each employee\'s "Attendance Device ID" field (Employee doctype) - ' +
    "set that to this device's PIN for each person. " +
    'log_type defaults to blank (ERPNext infers IN/OUT by alternating) - set it to "IN"/"OUT" if you know ' +
    "this device's status-code convention.",
};
