// Hardcoded, code-only registry of webhook body/header presets for common
// downstream systems. Not configurable from the admin UI (yet) - the
// admin UI only reads this list (GET /api/admin/webhook-templates) to
// populate a "use a template" picker in the device drawer, which prefills
// the URL/headers/body fields; the user still fills in their own
// URL/token placeholders and can freely edit anything afterward.
//
// To add a new template: create a file here following erpnext.ts's shape
// (a single exported WebhookTemplate), then import and list it below.
import { WebhookTemplate } from "./types";
import { erpnextEmployeeCheckin } from "./erpnext";

export type { WebhookTemplate };

export const WEBHOOK_TEMPLATES: WebhookTemplate[] = [erpnextEmployeeCheckin];
