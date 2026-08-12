# ADMS Server for ZKTeco Devices (Multitenant)

A Node.js server implementing the ZKTeco ADMS (push protocol) so ZKTeco
biometric/attendance devices (X100-C, SpeedFace, EFace, etc.) can connect
directly, with a multitenant admin layer on top: companies, devices, and
per-device webhook delivery of every punch (ATTLOG) record.

Protocol behavior mirrors [`saifulcoder/adms-server-ZKTeco`](https://github.com/saifulcoder/adms-server-ZKTeco)
(single-tenant PHP reference), reimplemented in Node/TypeScript with
multitenancy and per-device webhooks added on top.

## ⚠️ Security warning: device traffic is unencrypted

The `/iclock/*` ADMS endpoints are plain HTTP, by protocol necessity — ZKTeco
firmware cannot do TLS, logins, custom headers, or CSRF tokens (see
[Architecture](#architecture)). That means everything a device sends —
serial numbers, punch/attendance data, raw OPERLOG/USERINFO/FINGERTMP/FACE
payloads — travels **unencrypted and unauthenticated** between the device
and this server. Anyone on the same network path can read or spoof that
traffic.

**Do not expose `/iclock/*` directly to the public internet.** Only run this
server where the network path between it and your devices is trusted:

- A **private LAN** the devices and server both sit on, with no direct
  internet exposure of the ADMS port, or
- A **VPN/private tunnel** (site-to-site VPN, WireGuard, Tailscale, etc.)
  between the device's network and the server if they aren't on the same LAN.

The admin panel (`/api/admin/*`, `/admin`) is authenticated (JWT session
cookies, bcrypt-hashed passwords) but still travels over plain HTTP unless
you put a TLS-terminating reverse proxy (nginx, Caddy, a cloud load
balancer) in front of `server`'s port `8080` — worth doing even on a private
network, since admin session cookies and credentials pass through it.

## Architecture

- **`server.ts`** — the only process devices ever talk to. Serves the
  unauthenticated `/iclock/*` ADMS routes, the password-protected
  `/api/admin/*` JSON API, and the built admin SPA under `/admin`. It only
  ever **inserts** `PunchRecord` rows — it never calls a webhook itself.
- **`worker.ts`** — a completely separate process. Polls Postgres on an
  interval for punch records that haven't been webhook-delivered yet, and
  is the only thing that ever makes an outbound webhook call.
- **Postgres is the queue.** No Redis, no broker. `PunchRecord.webhookDelivered`
  / `nextAttemptAt` / `webhookAttempts` are the entire retry/backoff state.

This split matters: a slow or unreachable tenant webhook can never delay the
`OK` a device is waiting on, because the ingestion process never touches the
network for webhook delivery.

## Pointing a real ZKTeco device at this server

On the device: **Menu → COMM → Cloud Server Setting**

- **Server address**: the host/IP where this server is reachable
- **Server port**: `8080` (or whatever `PORT` is set to)
- **Enable Domain Name**: off (unless you're using a hostname)

That's it — the device itself constructs `/iclock/cdata`, `/iclock/getrequest`,
etc. against that host:port; there's nothing else to configure on the device.

Before a device's punches will be captured, register its serial number (SN)
under a company in the admin panel (`/admin` → Devices → "Register device").
Until then, its pings are still logged (see **Unregistered Devices** in the
admin panel) so you can "claim" it into a company once you see it show up.

## Running with Docker (recommended)

1. Copy the env template and fill in real values:

   ```bash
   cp .env.example .env
   ```

   At minimum set `JWT_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, and
   `ADMIN_BOOTSTRAP_PASSWORD`.

2. Bring up Postgres, run migrations, then start the server and worker —
   all in one command:

   ```bash
   docker compose up -d --build
   ```

   A one-shot `migrate` service applies `prisma migrate deploy` and exits;
   `server` and `worker` wait for it to finish successfully
   (`depends_on: condition: service_completed_successfully`) before they
   start, so there's no manual migration step and no race between multiple
   containers trying to migrate at once.

3. Point a device at `<host>:8080`. The admin panel is at
   `http://<host>:8080/admin`.

Only `server` publishes a port (`8080`) — it handles both device traffic
(`/iclock/*`) and the admin panel (`/admin`). `worker` has no exposed port;
it only makes outbound webhook calls.

If you change `prisma/schema.prisma` later and need to re-apply migrations
against an already-running stack, run the one-shot service again:

```bash
docker compose run --rm migrate
```

### First login

Log in at `/admin` with `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`.
This seed only ever runs once — the very first time the `AdminUser` table is
empty. **Change this password immediately** after first login (the UI will
force you to on first login). From then on, the bootstrap env var is
irrelevant; the account's real password lives in the database.

## Local development (without Docker)

Requires Node 20+ and a Postgres instance (local or Dockerized just for the
DB):

```bash
npm install
cp .env.example .env   # point DATABASE_URL at your local Postgres
npx prisma migrate dev
npm run dev:server      # ADMS + admin API, http://localhost:8080
npm run dev:worker      # webhook delivery worker, separate terminal
```

To build and serve the admin SPA locally through the same server (rather
than Vite's own dev server):

```bash
cd admin-ui && npm install && npm run build
```

`server.ts` serves `admin-ui/dist` under `/admin` automatically if it exists.

Or run the admin UI's own dev server (proxies `/api` to `:8080`):

```bash
cd admin-ui && npm run dev
```

## Testing the protocol without hardware

The ADMS endpoints are unauthenticated plain HTTP, so `curl`/Postman work
fine for simulating a device.

**Handshake:**

```bash
curl "http://localhost:8080/iclock/cdata?SN=BOCK200961014&options=all&pushver=2.4.0"
```

**Push punch records (ATTLOG):** body is tab-separated,
`<PIN>\t<datetime>\t<status>\t<verify-mode>\t<workcode>\t<reserved>\t<reserved>`,
one record per line, `\r\n`-separated:

```bash
curl -X POST "http://localhost:8080/iclock/cdata?SN=BOCK200961014&table=ATTLOG" \
  --data-binary $'1\t2024-07-28 01:25:24\t0\t1\t\t0\t0\r\n4\t2024-07-28 10:41:31\t0\t1\t\t0\t0'
```

A device with serial number `BOCK200961014` must already be registered
under a company (via the admin panel, or `POST /api/admin/devices`) for the
punches to be captured — otherwise the ping is logged under **Unregistered
Devices** and no `PunchRecord` rows are created.

**Command poll / connectivity test:**

```bash
curl "http://localhost:8080/iclock/getrequest?SN=BOCK200961014"
curl "http://localhost:8080/iclock/test"
```

Every one of these must return exactly `OK` (or the config text for
`cdata` GET) with `Content-Type: text/plain` — anything else and real
firmware will back off and keep retrying.

## Raw data / debugging

Two views exist purely for seeing what a device is actually sending, for
debugging firmware quirks:

- **Raw Data Dump** (admin panel → any admin) — everything a *registered*
  device pushes to `/iclock/cdata` that isn't a punch: `OPERLOG`,
  `USERINFO`, `FINGERTMP`, `FACE`, photos, or any other table name a
  firmware variant sends. Browsable per device, filterable by table name.
  Company admins only see their own company's devices; super admins can
  view any device. Also reachable from Devices → a device's "Raw Data" link.
- **Raw Request Log** (admin panel → super admin only) — an unconditional
  firehose of *every* `/iclock/*` request, registered or not, any table,
  including heartbeats. This is the lowest-level "what is actually hitting
  this server" view, filterable by serial number or endpoint.

Both store method, query string, headers, and the raw body (truncated at
10,000 characters) per entry. These tables grow with traffic volume — the
Raw Request Log especially, since it logs every heartbeat — so periodic
pruning is worth setting up for a long-running production deployment; none
is built in.

### Deleting records

Punch Records, Failed Webhooks, Raw Data Dump, and Raw Request Log all
support single-row and bulk delete (a header checkbox selects every row
currently on the page; a "Delete selected (N)" button acts on the
selection) — **super admin only**, even for a company_admin's own data, since
these are audit/attendance history and deletion is irreversible. Deleting a
punch record cascades to its webhook delivery attempt history.

## Webhook delivery

Each device has its own `webhookUrl` + `webhookSecret` + `webhookEnabled`
toggle (admin panel → Devices → Edit). When set, every captured punch is
POSTed as JSON to that URL:

```json
{
  "event": "punch.created",
  "company_id": "…",
  "device_id": "…",
  "device_serial": "BOCK200961014",
  "pin": "1",
  "punch_time": "2024-07-28T01:25:24.000Z",
  "status": 0,
  "verify_mode": 1,
  "work_code": null,
  "received_at": "2026-08-11T18:47:52.526Z"
}
```

signed with `X-Webhook-Signature: sha256=<hmac_sha256_hex(secret, raw_json_body)>`.

**`punch_time` is not a real UTC instant** — it's the device's literal
wall-clock digits (`YYYY-MM-DD HH:mm:ss` from the ATTLOG line) stamped with
a `Z` suffix, because the device sends no timezone information at all.
`received_at` (server-generated) is real UTC. If you need `punch_time` in a
particular timezone, treat the digits as-is (parse with a fixed UTC offset,
don't let your JSON/date library "helpfully" convert it) — the admin
panel's Punch Records / Failed Webhooks / delivery-log views do exactly
this (render in forced UTC) so the displayed time always matches what the
device's own clock showed, regardless of the admin's browser timezone.

Only a 2xx response marks it delivered. Failures back off (30s, 2m, 10m, 1h,
6h) up to `WEBHOOK_MAX_ATTEMPTS` (default 5), after which the record stays
visible under **Failed Webhooks** in the admin panel for manual or bulk
retry ("Retry now" resets attempts/backoff so the worker picks it up on its
next poll).

### "NA" status and configuring a webhook after punches already exist

A punch shows **NA** (not "pending") in the admin panel whenever nothing
will happen to it automatically right now — either its device has no
webhook configured/enabled, or it was captured *before* the device had a
webhook and hasn't been retried since.

That second case matters: if a device already has a backlog of punches and
you configure a webhook on it afterward, that backlog is **not** auto-sent.
Every punch remembers whether its device had a webhook at the moment it was
ingested (`PunchRecord.webhookHeld`); only punches ingested *after* the
webhook exists are picked up automatically. To send an old backlog punch
anyway, use **Retry now** (or bulk retry) on it explicitly — that's the only
thing that clears the hold. This avoids a surprise burst of delivery calls
the instant a webhook URL is saved.

### Custom headers and request body shape

The default payload shape above isn't always what a receiving endpoint
expects. Each device can override both, from the admin panel → Devices →
Edit:

- **Custom headers** — arbitrary key/value pairs sent with every request
  (e.g. `Authorization: Bearer <token>` for endpoints that need their own
  auth on top of, or instead of, the HMAC signature). Header values may
  contain `{{placeholder}}` tokens.
- **Custom request body** — a JSON template you write yourself, with
  `{{placeholder}}` tokens standing in for punch data. A leaf that is
  *exactly* `{{status}}` is substituted with the real typed value (a JSON
  number, not the string `"0"`); a placeholder embedded in a longer string
  (`"Punch by {{pin}}"`) is stringified and interpolated in place. Available
  placeholders: `pin`, `punch_time`, `punch_time_unix`, `status`,
  `verify_mode`, `work_code`, `device_id`, `device_serial`, `company_id`,
  `company_name`, `received_at`. Leaving this off falls back to the default
  `punch.created` shape above.

Example custom body template:

```json
{
  "employee_id": "{{pin}}",
  "clock_time": "{{punch_time}}",
  "note": "punched by {{pin}} on {{device_serial}}"
}
```

**Send test webhook**, in the same edit drawer, POSTs a realistic sample
punch (using the device's real ID/serial/company, but not a real punch
record) to whatever URL/headers/body template are currently in the form —
including unsaved edits — so you can verify the receiving endpoint's shape
and auth before going live. It never writes a `PunchRecord` or
`WebhookDelivery` row; it's a pure connectivity/shape check.

## Environment variables

See [`.env.example`](.env.example) for the full list. Notable ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Signs admin session cookies — must be a real secret |
| `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` | One-time seed for the first super-admin |
| `WEBHOOK_MAX_ATTEMPTS` | Retries before a punch is marked "failed" in the admin panel |
| `WORKER_POLL_INTERVAL_MS` / `WORKER_BATCH_SIZE` | How often / how many rows the worker claims per tick |

## Tests

```bash
npm test
```

Covers the ATTLOG tab-separated line parser against the sample payloads
from the protocol spec, including malformed-line isolation (one bad line
must never drop the rest of a batch or crash the request).
