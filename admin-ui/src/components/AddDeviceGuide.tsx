import { useState } from "react";
import { CirclePlus } from "lucide-react";
import { CompanyOption } from "../api";

// The single "how to add a device" explainer, shown at the top of
// Unregistered Devices (the Devices page's "+ Add device" button links
// there). Replaces the old separate "How to add a device" + "Connect a
// device" cards, which repeated each other.
//
// company_admin only ever has one company in `companies` (the options
// endpoint scopes it that way), so there's nothing to pick. super_admin gets
// every company and needs a picker - there's no single slug to put in the
// server address otherwise.
// Most secure first. Some firmware rejects any scheme prefix, hence the
// bare third option.
const ADDRESS_OPTIONS = [
  { scheme: "https://", note: "" },
  { scheme: "http://", note: "" },
  { scheme: "", note: "(if the device won't accept https:// or http://)" },
];

export default function AddDeviceGuide({
  companies,
  isSuperAdmin,
}: {
  companies: CompanyOption[];
  isSuperAdmin: boolean;
}) {
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const company = companies.find((c) => c.id === selectedCompanyId) ?? companies[0];

  // Bare host[:port] with https:// spelled out, rather than reusing
  // window.location.origin - whatever scheme the admin panel happens to be
  // loaded over isn't necessarily the one to recommend first.
  const host = window.location.host;

  return (
    <div className="card guide">
      <h3>Add a device</h3>

      <ol className="steps">
        <li>
          <div className="step-title">Connect the device to this server</div>
          {company ? (
            <>
              <p>
                On the device, go to <strong>Menu → COMM → Cloud Server Setting</strong>. Turn on{" "}
                <strong>Enable Domain Name</strong>, then enter one of these as the <strong>Server address</strong>.
                Start with the first; only move down the list if it doesn't connect.
              </p>

              {isSuperAdmin && companies.length > 1 && (
                <div className="field guide-company">
                  <label htmlFor="guide-company">Company</label>
                  <select
                    id="guide-company"
                    value={company.id}
                    onChange={(e) => setSelectedCompanyId(e.target.value)}
                  >
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <ol className="address-options">
                {ADDRESS_OPTIONS.map((opt) => (
                  <li key={opt.scheme}>
                    <code className="mono">
                      {opt.scheme}
                      {host}/{company.slug}/<span className="placeholder">your-secret</span>
                    </code>
                    {opt.note && <span className="option-note"> {opt.note}</span>}
                  </li>
                ))}
              </ol>
              <p className="hint">
                Replace <span className="placeholder">your-secret</span> with a secret of your choice. The device
                keeps it once claimed.
              </p>
            </>
          ) : (
            <p>Create a company first — the server address includes the company it belongs to.</p>
          )}
        </li>

        <li>
          <div className="step-title">Check that it's connected</div>
          <p>
            Wait about a minute, then click <strong>Refresh</strong> below. If the device isn't listed, go back and
            try the next address — the device itself won't show an error.
          </p>
        </li>

        <li>
          <div className="step-title">Claim it</div>
          <p>
            Choose the device's timezone and click{" "}
            <CirclePlus size={14} className="inline-icon" aria-label="Claim" />. It moves to the{" "}
            <strong>Devices</strong> page.
          </p>
        </li>

        <li>
          <div className="step-title">Restart the device</div>
          <p>
            Wait 10–15 seconds after claiming, then restart the device manually so it picks up its new settings.
          </p>
        </li>
      </ol>
    </div>
  );
}
