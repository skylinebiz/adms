import { PunchRecord } from "../api";

// "not_applicable" means nothing will happen automatically right now - the
// device has no webhook configured (or it's disabled), or this specific
// record was ingested before a webhook existed and hasn't been retried
// since. Shown as "NA" rather than "pending" so it isn't mistaken for
// something about to be delivered.
export function webhookStatusLabel(status: PunchRecord["webhookStatus"]): string {
  if (status === "not_applicable") return "NA";
  return status;
}
