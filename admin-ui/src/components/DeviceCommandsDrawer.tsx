import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, DeviceCommandLog } from "../api";

interface Props {
  deviceId: string;
  serialNumber: string;
  onClose: () => void;
}

// Dedicated drawer for a single device's raw ADMS command tool - split out
// of the device drawer, which was getting congested. Diagnostic tool:
// queues an arbitrary command for delivery on the device's next
// /iclock/getrequest poll and shows whether/how it responds.
export default function DeviceCommandsDrawer({ deviceId, serialNumber, onClose }: Props) {
  const [commandText, setCommandText] = useState("");
  const [sendingCommand, setSendingCommand] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commands, setCommands] = useState<DeviceCommandLog[]>([]);
  const [loadingCommands, setLoadingCommands] = useState(false);

  function loadCommands() {
    setLoadingCommands(true);
    api
      .listDeviceCommands(deviceId)
      .then(({ commands }) => setCommands(commands))
      .finally(() => setLoadingCommands(false));
  }

  useEffect(() => {
    loadCommands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  async function onSendCommand(e: FormEvent) {
    e.preventDefault();
    if (!commandText.trim()) return;
    setCommandError(null);
    setSendingCommand(true);
    try {
      await api.sendDeviceCommand(deviceId, commandText.trim());
      setCommandText("");
      loadCommands();
    } catch (err) {
      setCommandError(err instanceof ApiError ? err.message : "Failed to queue command");
    } finally {
      setSendingCommand(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Commands: {serialNumber}</h3>
        <div className="field">
          <label>Send raw ADMS command</label>
          <div className="muted" style={{ marginBottom: 6 }}>
            Queues a raw command for this device's next <code className="mono">/iclock/getrequest</code> poll,
            delivered as <code className="mono">C:&lt;id&gt;:&lt;command&gt;</code>. Diagnostic tool - there's no
            complete public spec for this protocol, so this is often the only way to find out what a given firmware
            actually understands. Whether/how the device responds shows up below once it polls again.
          </div>
          <form onSubmit={onSendCommand} style={{ display: "flex", gap: 8 }}>
            <input
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              placeholder="e.g. SET OPTIONS DateTime=1786968000"
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn" disabled={sendingCommand || !commandText.trim()}>
              {sendingCommand ? "Queuing…" : "Send"}
            </button>
          </form>
          {commandError && (
            <div className="error-banner" style={{ marginTop: 8 }}>
              {commandError}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
            <strong style={{ fontSize: 13 }}>Recent commands</strong>
            <button type="button" className="btn btn-sm" onClick={loadCommands} disabled={loadingCommands}>
              {loadingCommands ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          {commands.length === 0 ? (
            <div className="muted" style={{ marginTop: 6 }}>
              No commands sent to this device yet.
            </div>
          ) : (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              {commands.map((c) => (
                <div key={c.id} className="card" style={{ padding: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <code className="mono" style={{ wordBreak: "break-all" }}>
                      {c.command}
                    </code>
                    <span className={`badge badge-${c.status.toLowerCase()}`}>{c.status}</span>
                  </div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    Queued {new Date(c.createdAt).toLocaleString()}
                    {c.ackedAt ? ` · ACKed ${new Date(c.ackedAt).toLocaleString()}` : ""}
                  </div>
                  {c.response && (
                    <div
                      className="mono"
                      style={{
                        marginTop: 4,
                        background: "var(--neutral-tint)",
                        padding: 6,
                        borderRadius: 4,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-all",
                      }}
                    >
                      {c.response}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 8 }}>
          <button className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
