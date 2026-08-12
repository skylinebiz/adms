import PunchRecordsTable from "../components/PunchRecordsTable";

export default function FailedWebhooks() {
  return (
    <div>
      <h2>Failed Webhooks</h2>
      <p className="muted">
        Punch records whose webhook retries are exhausted, or whose most recent delivery attempt errored.
      </p>
      <PunchRecordsTable mode="failed" />
    </div>
  );
}
