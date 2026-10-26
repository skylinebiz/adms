# CLAUDE.md

Multitenant ADMS server for ZKTeco/eSSL attendance devices. Devices push punches
over HTTP; the server stores them per company, shows them in an admin UI, and
forwards each to a webhook (e.g. ERPNext) with retries. Hosted at adms.adrk.in;
the same code is self-hostable. See `README.md` for the user-facing story.

## Stack and layout

- Node + TypeScript, Express 4, Prisma 5 on PostgreSQL, zod, pino, vitest.
- `src/adms/` - unauthenticated device protocol (`/iclock/*`): cdata, getrequest,
  devicecmd, parsers, `deviceLookup.ts` (device resolution/trust).
- `src/admin/` - admin JSON API (cookie + JWT auth): auth, companies, devices,
  adminUsers, settings, punchRecords, webhookTemplates, seed.
- `src/webhooks/` - dispatcher and templates (run by `src/worker.ts`).
- `src/server.ts` / `src/app.ts` - HTTP server; `src/worker.ts` - webhook worker;
  `src/retentionSweep.ts` - data retention (hosted keeps 10 days).
- `admin-ui/` - Vite + React admin panel (own `package.json`/`node_modules`).
- `prisma/` - schema and migrations. `tests/` - vitest specs (`tests/security/*`
  covers isolation, validation, SSRF).

## Commands

```bash
npm run dev:server      # tsx watch server
npm run dev:worker      # tsx watch webhook worker
npm test                # vitest run (needs Postgres, see below)
npm run build           # tsc server; build:client builds admin-ui
npm run prisma:migrate  # prisma migrate dev (creates a migration)
docker compose up -d --build   # postgres + migrate + server + worker
```

Tests and `prisma migrate dev` run on the host against the compose Postgres,
bound to `127.0.0.1:5432` (matches `DATABASE_URL` in `.env.example`). Copy
`.env.example` to `.env` first. Install deps in both root and `admin-ui/`.

## Things that are easy to get wrong

- **Prisma tables are `@@map`ped to snake_case plurals** (`admin_users`,
  `companies`, `devices`, ...). Raw SQL in migrations must use the mapped name,
  not the model name. Check `@@map` in `prisma/schema.prisma`.
- **Migrations auto-run** via the compose `migrate` service
  (`prisma migrate deploy`) before server/worker start. A failed migration blocks
  all later ones until
  `prisma migrate resolve --rolled-back <name>` is run on that database.
- **Device URL shape:** `/:companySlug/:secret/iclock/...` (mounted in `app.ts`).
  Lookup is by serial number; the path secret only validates a device that is
  already registered. Unknown SN -> pending device (always acked `OK`). Known SN
  with wrong/missing secret -> 401 ("registered device request missing or
  invalid secret"). Secrets are not unique and never a lookup key.
- **`/iclock/*` is intentionally unauthenticated/CSRF-exempt** (firmware can't
  do auth) and is mounted before the admin API's JSON/cookie/CORS middleware.
  Don't add auth middleware ahead of it.
- **Admin emails are lowercased and trimmed** in zod schemas on signup, login,
  and admin-user create/update, and in the seed. Keep that on any new path that
  accepts an email.
- **Password forms need a confirm field** (signup, new admin user, reset); the
  server API takes a single `password`.
- Public signup and login are rate limited (`middleware/rateLimit.ts`);
  `TRUST_PROXY_HOPS` controls client-IP detection behind a proxy.

## Release convention

Every change that lands gets its own SemVer bump, in the same commit:
`package.json`, `package-lock.json` (two places), and a new top entry in
`CHANGELOG.md`. Commit subject format: `vX.Y.Z: short description`. MINOR for
features, PATCH for fixes. Work happens on `claude/*` worktree branches; `main`
is fast-forwarded and pushed to `origin` (github.com/skylinebiz/adms).

## Environment notes

Developed on Windows (PowerShell + Git Bash; no `python` on PATH). Line endings
may warn LF->CRLF; that is harmless.

## Behavior and design decisions (distilled from CHANGELOG, v1.0.0 -> now)

`CHANGELOG.md` is the full history; entries before 2.3.0 are a retroactive
reconstruction. This section is what a new session needs to know without
reading it all.

### Product and tenancy
- v1 was an admin-managed ADMS server; **v2.0.0 pivoted to public self-service
  signup**: anyone creates a company and becomes its COMPANY_ADMIN. The old bare
  `/:secret/iclock` path was removed - every device URL carries the company slug.
- Roles: `SUPER_ADMIN` (companyId null, platform-wide: Settings, Companies,
  all admin users) and `COMPANY_ADMIN` (scoped to one company). Every list/action
  endpoint must AND the caller's company scope; foreign IDs in bulk arrays are
  silently dropped, not 500'd. A COMPANY_ADMIN with no company must never be
  treated as "no filter" (a past cross-company leak, 2.0.4).
- Company slugs are immutable after creation (changing one orphans devices'
  configured URLs), looked up case-insensitively, and reserved words
  (admin/api/health) can never be slugs.
- A super admin can disable public signup (Settings; `signup-status` is public).
  The seeded bootstrap super admin has `mustChangePassword: true`.

### Device protocol (`src/adms`)
- Routes accept both bare and eSSL `.aspx` spellings (`/iclock/cdata.aspx`).
- **Response policy:** `200 OK` for normal acks; `401` for a registered device
  with a bad secret; `503` (withhold ack so the device retries) for data-bearing
  endpoints from an unclaimed device or when the DB is unreachable (2.1.x);
  never JSON on device-facing errors, always plain text. Oversized bodies
  (`ADMS_MAX_BODY_SIZE`, default 10mb) are acked `OK` but dropped and logged, so
  a device can't loop on one payload. Bad-data DB errors skip only the offending
  records; punch insert is one atomic batch.
- Unknown SN -> `PendingDevice` (captures secret + company from the slug; raw
  `UnregisteredDevicePing` logged only on first contact). Claiming requires a
  timezone (mandatory) and carries the pending secret over; label defaults to
  the serial number. Direct `POST /devices` still exists for scripts, but the UI
  has one path: ping, then claim.
- Device **timezone** (IANA, required) converts the device's naive wall-clock
  punch digits to `PunchRecord.punchTimeUtc`. The handshake (`GET cdata`) sends
  `TimeZone=` (minutes offset, e.g. 330 for IST), confirmed on real eSSL
  hardware; it is NOT sent from `getrequest` (tried and removed in 2.6.2). A
  device may need a power cycle to re-handshake. A never-claimed device's first
  handshake can't carry a timezone; recommend claim then restart.
- `devicecmd` ACKs match `ID=([^&\s]+)`. Manual raw ADMS command tool lives in
  the device Commands dialog.
- Device status (`UNKNOWN/ONLINE/OFFLINE`) is **computed from `lastSeenAt`** at
  read time (`DEVICE_OFFLINE_THRESHOLD_MS`, default 5 min), not stored.
- Request logging: `[req]` on arrival, `[res]` on completion, `[tcp]` for raw
  socket/protocol errors. `GET /` 301s to `/admin`; `robots.txt` disallows all.
- `/health` does a real DB round trip.

### Webhooks (`src/webhooks`, run by `worker.ts`)
- Per-device URL, enabled flag, secret (HMAC `X-Webhook-Signature`), custom
  headers, custom body template with placeholders (`punch_time`,
  `punch_time_utc`, `punch_time_frappe`, `device_timezone`, ...).
- Hardcoded templates live in `src/webhooks/templates/` (register in its
  `index.ts`). Only one so far: ERPNext/Frappe Employee Checkin (`log_type` must
  be `""`, not `"Auto"`).
- Max attempts (default 5) and timeout (default 8000ms) are **`PlatformSettings`
  DB values editable in Settings, not env vars**; they apply live with no restart.
- Status is derived from attempt history: "not applicable" only for records that
  never had a webhook to try; anything with attempts reports failed/pending from
  its own history even if the webhook is later removed. `webhookAttempts` is a
  lifetime counter, never reset: manual **Retry** adds exactly one attempt and is
  disabled/rejected when the device has no active webhook. Punches ingested
  before a webhook exists are not backfilled when one is added.
- **SSRF guard** (`utils/ssrfGuard.ts`): webhook URLs resolving to loopback,
  RFC1918, link-local or cloud-metadata addresses are rejected at save time and
  again at dispatch (including "Send test webhook"). DNS-rebinding is a known
  residual caveat (see README).
- Delivery log stores the request URL/headers/body actually sent
  (`WebhookDelivery.requestBody/requestHeaders`, nullable for old rows).

### Security and operations
- `JWT_SECRET` is required with no fallback (config validates eagerly at import,
  so `worker` also needs it in docker-compose even though it never signs).
- Shared `errorHandler` passes through well-formed 4xx (malformed JSON, 413) and
  only escalates unexpected errors to 500. A nonexistent but well-formed
  `companyId` (FK `P2003`) must return 400, not 500.
- Rate limits are in-memory per instance (reset on restart): signup 5/hour/IP
  (all attempts count); login failures 30/15min/IP and 10/15min/email, success
  clears the email counter; over limit is `429` + `Retry-After`. Set
  `TRUST_PROXY_HOPS` to the number of reverse proxies in front of the app, and
  pass it through docker-compose (it must be listed in the compose `environment`).
- **Data retention:** `PlatformSettings.dataRetentionDays` (default 30; hosted
  uses 10). `runRetentionSweep()` in `src/retentionSweep.ts` runs hourly and at
  startup from the worker, deleting punches (cascading deliveries), raw logs,
  unregistered pings and command history. Never deletes companies, devices,
  admin users or pending-device summaries.
- Raw logs store request bodies in full (no truncation since 2.20.0). List
  endpoints return `bodySize`; bodies load on demand via
  `GET /api/raw-requests/:id` and `GET /api/devices/:id/raw-logs/:logId`.
- `buildApp()` in `src/app.ts` builds the Express app without binding a port so
  tests can drive it with supertest.

### Admin UI conventions
- All tables are server-side datatables via `src/utils/datatable.ts` (whitelisted
  sort columns, stable `id` tiebreaker, case-insensitive search; one index per
  sortable column). Don't add sorting on computed/free-text columns.
- Row actions are icon-only `IconButton`s (lucide-react) with hover labels.
- Devices page: Edit (definition only), Webhook, and Commands are separate
  dialogs. Settings is one card with one Save button (signups, retention,
  webhook delivery, date/time display).
- Date/time display format is a per-browser `localStorage` preference
  (`utils/dateFormat.ts`); punch times follow `formatPunchTime`/`formatAccurateTime`.
- App version comes from `package.json` via public `GET /api/admin/version`.
- Mobile: tables scroll horizontally (`.table-wrap`, `.actions-cell` is
  `nowrap`), no fixed max-width on `.main`.

### Tests
- `tests/security/` is an E2E suite against a real Postgres (auth required on
  every route, role authorization, cross-company IDOR, hostile-input fuzzing,
  SSRF). `tests/helpers/securityTestApp.ts` `cleanupAll()` deletes fixtures by
  tagged email (super-admin fixtures have no company to cascade from).
