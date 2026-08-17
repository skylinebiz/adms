// A hardcoded, code-only preset that prefills a device's webhook URL,
// headers, and body template for a common downstream system. See
// index.ts for how to add a new one - not configurable from the admin UI
// (yet); the admin UI only ever reads this list (GET
// /api/admin/webhook-templates) to populate a "use a template" picker in
// the device drawer.
export interface WebhookTemplate {
  // Stable key - never reuse or repurpose one, even if the template is
  // renamed, since a UI could plausibly persist a chosen id.
  id: string;
  // Shown in the picker dropdown.
  name: string;
  // One or two sentences, shown once a template is selected.
  description: string;
  // Prefilled into the Webhook URL field verbatim, deliberately containing
  // obvious ALL-CAPS placeholder text (e.g. "YOUR-SITE") for the parts
  // only the user can know - not run through the {{placeholder}} engine,
  // since the webhook URL itself is never templated at dispatch time.
  urlPlaceholder: string;
  // Prefilled into the custom headers editor verbatim - same
  // ALL-CAPS-placeholder convention as urlPlaceholder for secrets/tokens
  // only the user can supply.
  headers: Record<string, string>;
  // Prefilled into the custom body template editor (also flips "Use a
  // custom request body" on). Uses real {{placeholder}} tokens from
  // PunchTemplateVars - these ARE rendered per-punch at dispatch time.
  bodyTemplate: unknown;
  // Longer setup guidance shown alongside description once selected -
  // what to replace, where to find credentials, version-specific gotchas.
  helpText: string;
}
