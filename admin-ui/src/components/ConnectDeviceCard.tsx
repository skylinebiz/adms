import { ReactNode, useState } from "react";
import { CompanyOption } from "../api";

// Shared by Devices.tsx and UnregisteredDevices.tsx - the only real
// difference between the two call sites is the trailing sentence about
// what happens after the device's first ping (passed in as `trailingNote`).
//
// company_admin only ever has one company in `companies` (the options
// endpoint scopes it that way), so there's nothing to pick - the card just
// uses it directly. super_admin gets every company and needs a picker:
// there's no single slug to put in the example URL otherwise. This is why
// the card was company_admin-only when it first shipped (v2.6.3) - not a
// deliberate exclusion, just never built out for the "which company" case
// super_admin introduces.
export default function ConnectDeviceCard({
  companies,
  isSuperAdmin,
  trailingNote,
}: {
  companies: CompanyOption[];
  isSuperAdmin: boolean;
  trailingNote: ReactNode;
}) {
  const [selectedCompanyId, setSelectedCompanyId] = useState("");

  if (companies.length === 0) return null;
  const company = companies.find((c) => c.id === selectedCompanyId) ?? companies[0];

  // Bare host[:port], no scheme - built up explicitly per option below
  // instead of reusing window.location.origin (which already has whatever
  // scheme the admin panel itself happens to be loaded over baked in, not
  // necessarily the one worth recommending first).
  const host = window.location.host;
  const path = `${company.slug}/<any-secret-you-choose>`;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Connect a device</h3>

      {isSuperAdmin && companies.length > 1 && (
        <div className="field" style={{ maxWidth: 280 }}>
          <label>Company</label>
          <select value={company.id} onChange={(e) => setSelectedCompanyId(e.target.value)}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="muted">
        On the device: <strong>Menu → COMM → Cloud Server Setting</strong>.
      </p>
      <p className="muted">
        <strong>Enable Domain Name: ON</strong> — required for the hostname-based address below.
      </p>
      <p className="muted" style={{ marginBottom: 4 }}>
        <strong>Server address</strong> — try these in order, most secure first, stopping as soon as one works:
      </p>
      <ol style={{ margin: "0 0 8px", paddingLeft: 20 }}>
        <li>
          <code className="mono">{`https://${host}/${path}`}</code>
        </li>
        <li>
          <code className="mono">{`http://${host}/${path}`}</code>
        </li>
        <li>
          <code className="mono">{`${host}/${path}`}</code>{" "}
          <span className="muted">(if your firmware rejects a scheme prefix on the first two)</span>
        </li>
      </ol>
      <p className="muted" style={{ marginBottom: 0 }}>
        The device won't show an error either way — try one, wait a bit, and check back here to see if it worked.
      </p>
      <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
        {trailingNote}
      </p>
    </div>
  );
}
