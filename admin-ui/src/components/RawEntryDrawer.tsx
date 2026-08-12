import type { CSSProperties } from "react";

interface RawEntry {
  createdAt: string;
  method: string;
  endpoint: string;
  table?: string | null;
  serialNumber?: string | null;
  query: string | null;
  headers: string | null;
  rawBody: string | null;
}

function prettyJson(raw: string | null): string {
  if (!raw) return "(none)";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const preStyle: CSSProperties = {
  background: "#f3f4f6",
  padding: 8,
  borderRadius: 6,
  fontSize: 11,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  maxHeight: 220,
  overflow: "auto",
};

export default function RawEntryDrawer({ entry, onClose }: { entry: RawEntry; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Raw entry</h3>
        <div className="card">
          <div>
            <strong>{entry.method}</strong> <code className="mono">{entry.endpoint}</code>
          </div>
          {entry.table && (
            <div style={{ marginTop: 4 }}>
              Table: <span className="badge badge-pending">{entry.table}</span>
            </div>
          )}
          {entry.serialNumber !== undefined && (
            <div className="muted" style={{ marginTop: 4 }}>
              SN: {entry.serialNumber ?? "(missing)"}
            </div>
          )}
          <div className="muted" style={{ marginTop: 4 }}>
            {new Date(entry.createdAt).toLocaleString()}
          </div>
        </div>

        <h4>Query</h4>
        <pre style={preStyle}>{prettyJson(entry.query)}</pre>

        <h4>Headers</h4>
        <pre style={preStyle}>{prettyJson(entry.headers)}</pre>

        <h4>Body</h4>
        <pre style={preStyle}>{entry.rawBody || "(empty)"}</pre>

        <button className="btn" onClick={onClose} style={{ marginTop: 12 }}>
          Close
        </button>
      </div>
    </div>
  );
}
