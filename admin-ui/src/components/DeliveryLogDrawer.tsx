import { useEffect, useState } from "react";
import { api, PunchRecord, WebhookDelivery } from "../api";
import { formatPunchTime } from "../utils/formatTime";
import Pagination from "./Pagination";

const PAGE_SIZE = 10;

export default function DeliveryLogDrawer({ punchRecordId, onClose }: { punchRecordId: string; onClose: () => void }) {
  const [punchRecord, setPunchRecord] = useState<PunchRecord | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.getDeliveries(punchRecordId, { page, pageSize: PAGE_SIZE }).then(({ punchRecord, deliveries, total }) => {
      setPunchRecord(punchRecord);
      setDeliveries(deliveries);
      setTotal(total);
      setLoading(false);
    });
  }, [punchRecordId, page]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Delivery log</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {punchRecord && (
              <div className="card">
                <div>
                  PIN <strong>{punchRecord.devicePin}</strong> · {formatPunchTime(punchRecord.punchTime)}
                </div>
                <div className="muted">
                  Device: {punchRecord.device?.label ?? punchRecord.device?.serialNumber}
                </div>
                <div style={{ marginTop: 8 }}>
                  <span className={`badge badge-${punchRecord.webhookStatus}`}>{punchRecord.webhookStatus}</span>{" "}
                  <span className="muted">{punchRecord.webhookAttempts} attempt(s)</span>
                </div>
                {punchRecord.lastWebhookError && (
                  <div className="error-banner" style={{ marginTop: 10 }}>
                    {punchRecord.lastWebhookError}
                  </div>
                )}
              </div>
            )}

            <h4>Attempt history</h4>
            {deliveries.length === 0 && <p className="muted">No delivery attempts yet.</p>}
            {deliveries.map((d) => (
              <div className="card" key={d.id}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>Attempt {d.attempt}</strong>
                  <span className={`badge ${d.delivered ? "badge-delivered" : "badge-failed"}`}>
                    {d.delivered ? "delivered" : "failed"}
                  </span>
                </div>
                <div className="muted">{new Date(d.createdAt).toLocaleString()}</div>
                <div style={{ marginTop: 6 }}>
                  Status code: {d.statusCode ?? <span className="muted">n/a</span>}
                </div>
                {d.error && <div className="error-banner" style={{ marginTop: 6 }}>{d.error}</div>}
                {d.responseBody && (
                  <pre
                    style={{
                      marginTop: 6,
                      background: "#f3f4f6",
                      padding: 8,
                      borderRadius: 6,
                      fontSize: 11,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      maxHeight: 120,
                      overflow: "auto",
                    }}
                  >
                    {d.responseBody}
                  </pre>
                )}
              </div>
            ))}

            {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
          </>
        )}
        <button className="btn" onClick={onClose} style={{ marginTop: 12 }}>
          Close
        </button>
      </div>
    </div>
  );
}
