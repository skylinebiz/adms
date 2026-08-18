import dns from "node:dns/promises";
import net from "node:net";

// A device's webhookUrl is attacker-controlled input from the lowest
// privilege level this API has (any authenticated company_admin, including
// one who just self-signed-up with no vetting) and gets fetched by the
// server itself - both synchronously via POST /devices/:id/test-webhook
// (which echoes the response body straight back to the caller) and
// asynchronously by the worker on every real punch. With no restriction on
// the target host, that's a full SSRF primitive: point it at
// 169.254.169.254 (cloud metadata), an internal service's hostname, or
// 127.0.0.1/localhost, and read back whatever it says. This only checks the
// target at save/dispatch time - it does not pin the resolved IP for the
// actual fetch() that follows, so a DNS-rebinding attacker (control the
// domain, flip its A record between the check and the request) can still
// slip through. Closing that fully would mean routing the request through a
// custom dispatcher bound to the address we already resolved, which is a
// larger change than this guard - worth doing if this ever needs to be
// airtight, not just "blocks the obvious payloads."
function isPrivateOrReservedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata endpoint
    if (a === 0) return true; // "this" network
    if (a >= 224) return true; // multicast (224-239) + reserved (240-255)
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local fc00::/7
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped && net.isIP(mapped[1]) === 4) return isPrivateOrReservedIp(mapped[1]);
    return false;
  }
  return true; // couldn't even parse as an IP - fail closed
}

export async function isSafeWebhookUrl(rawUrl: string): Promise<{ safe: true } | { safe: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: "Webhook URL must use http or https" };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost") {
    return { safe: false, reason: "Webhook URL may not target localhost" };
  }

  if (net.isIP(hostname)) {
    return isPrivateOrReservedIp(hostname)
      ? { safe: false, reason: "Webhook URL may not target a private or reserved network address" }
      : { safe: true };
  }

  let addresses: string[];
  try {
    addresses = (await dns.lookup(hostname, { all: true })).map((a) => a.address);
  } catch {
    return { safe: false, reason: "Could not resolve webhook host" };
  }
  if (addresses.length === 0 || addresses.some(isPrivateOrReservedIp)) {
    return { safe: false, reason: "Webhook URL may not target a private or reserved network address" };
  }
  return { safe: true };
}
