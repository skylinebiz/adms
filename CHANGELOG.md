# Changelog

All notable changes to this project are documented in this file.

Versioning follows [Semantic Versioning](https://semver.org/)
(`MAJOR.MINOR.PATCH`): MAJOR for breaking changes, MINOR for
backward-compatible features, PATCH for backward-compatible fixes.

> Entries up to and including **2.2.0** are a retroactive reconstruction
> from git history - this project wasn't versioned from day one. The
> commit hash after each entry is the change it corresponds to. From
> **2.3.0** onward, every change that lands gets its own version bump and
> its own entry here, in the same commit as the change itself.

## [2.10.2] - 2026-08-18

### Fixed

- **Worker container crash-looped on `Missing required environment
  variable: JWT_SECRET`** - a direct regression from 2.10.0's fix. That
  change correctly made `JWT_SECRET` a hard requirement (no more insecure
  fallback) for `server.ts`, which does sign/verify admin session tokens -
  but `worker.ts` imports the same shared `src/config.ts`, which validates
  every field eagerly at import time regardless of which ones the
  importing entry point actually reads. `worker.ts` never touches a JWT at
  all, and its `docker-compose.yml` environment block never included
  `JWT_SECRET` (it didn't need to, before the fallback was removed).
  `worker` now receives `JWT_SECRET` the same way `server` already does.

## [2.10.1] - 2026-08-18

### Added

- 10 more E2E security tests, prompted by a direct question about two gaps
  in the 2.10.0 review: whether query-string filters referencing a real
  resource are checked for ownership (they were - `?deviceId=`/`?companyId=`
  on every list endpoint stay AND'd with the caller's own company scope,
  confirmed for punch-records, admin-users, and unregistered-pings), and
  whether a real-but-foreign ID mixed into a bulk array is handled
  correctly (it is - silently dropped, not 500'd and not acted on). Also
  added a same-company cross-device raw-log ID confusion check, and a
  syntactically-valid-but-nonexistent `companyId` check across every
  create/claim endpoint - the last of which surfaced the bug below.

### Fixed

- **A well-formed but nonexistent `companyId` crashed device/admin-user
  creation with a 500** instead of a clean rejection. `POST /devices`,
  `POST /devices/claim`, and `POST /admin-users` all trust the request
  body's `companyId` once a super_admin sends it (a company_admin is
  already forced to their own real company, but super_admin is
  deliberately exempt from that check) - a fabricated ID trips the
  database's foreign-key constraint instead of any validation the app
  itself was doing, and that constraint violation was propagating as an
  unhandled rejection through `errorHandler`'s generic 500 path. All three
  now catch it (`P2003`) and return a clean 400.

## [2.10.0] - 2026-08-18

### Added

- Full end-to-end security test suite (`tests/security/`, 240 new tests
  across 4 files) driving the real Express app + a live Postgres DB via
  supertest, no mocking: every protected route rejects a missing/garbage/
  forged/expired session (`authRequired.spec.ts`), every super_admin-only
  action 403s a real company_admin session (`roleAuthorization.spec.ts`),
  cross-company IDOR coverage on every resource type
  (`crossCompanyIsolation.spec.ts`), and hostile-JSON fuzzing across every
  create/update endpoint - wrong types, mass-assignment attempts, SQLi-
  shaped strings, prototype-pollution keys, malformed JSON, oversized
  payloads (`inputValidation.spec.ts`).
- `src/app.ts`: extracted the Express app construction out of `server.ts`
  into a `buildApp()` factory with no port binding, so the test suite above
  can exercise the real middleware stack in-process.
- `src/utils/ssrfGuard.ts`: rejects a device `webhookUrl` that resolves to
  a loopback/RFC1918/link-local/cloud-metadata address, checked at
  create/update time and again at dispatch time (both the real worker send
  and the on-demand "Send test webhook" button).
- `docker-compose.yml`: publishes postgres to `127.0.0.1:5432` so the new
  test suite (and `prisma migrate dev`) can reach it from the host.

### Fixed

- **SSRF via webhook URL** (found by the security review above): any
  authenticated company_admin — including a brand-new, unvetted
  self-signup — could point a device's `webhookUrl` at an internal address
  (loopback, a private-network host, the cloud metadata endpoint) and, via
  "Send test webhook," get the response echoed straight back to them. Now
  blocked by `ssrfGuard.ts`; see the new "Webhook delivery" note in the
  README for the residual DNS-rebinding caveat.
- **JWT_SECRET silently defaulted to a hardcoded, publicly-known string**
  if the env var was unset - a deployment that forgot to set it would boot
  fine and sign every admin session (including super_admin) with a secret
  anyone could read in this repo. Now required at startup with no
  fallback; the server refuses to boot rather than run insecurely.
- **Malformed/oversized request bodies returned a generic 500** instead of
  the 400/413 body-parser had already correctly determined - the shared
  `errorHandler` was discarding any status code already attached to an
  error (JSON syntax errors, payload-too-large) and collapsing everything
  to "Internal server error." Now passes through a well-formed 4xx as-is
  and only escalates genuinely unexpected errors to 500.

## [2.9.1] - 2026-08-17

### Fixed

- Mobile viewport pass across the admin UI. Table-layout's `auto` sizing was
  squeezing narrow-content cells down to a sliver whenever a table had other
  wide columns, starving their `flex-wrap` contents of room:
  - Every table's actions cell (Edit/Webhook/Commands/Delete/etc. buttons)
    was wrapping one button per line and stretching rows absurdly tall on
    phone-width screens. Introduced a shared `.actions-cell` class
    (`min-width: 200px`) and applied it across Devices, Unregistered
    Devices, Punch Records, Raw Data Dump, and Raw Request Log.
  - The per-row timezone `<select>` on the Unregistered Devices claim table
    was squeezed to ~57px, showing only "(UTC" with the option text
    clipped - an admin couldn't tell what timezone they were about to claim
    a device with. Same issue on the super-admin company picker in that
    table. Both cells now carry an explicit `min-width`.
  - The "Create company" button sat pinned to one side of the form on
    narrow screens instead of reading as the primary action. It now goes
    full-width below the Name/Slug fields under 480px.

## [2.9.0] - 2026-08-17

### Changed

- Split the device drawer into three focused dialogs, opened directly
  from the Devices list instead of one congested form:
  - **Device drawer** (Edit) now holds only device *definition* fields -
    serial number, label, secret, timezone.
  - New **Webhook** dialog (new "Webhook" button per row) holds
    everything webhook-related - URL, enabled toggle, secret, custom
    headers, custom body template, template picker, send test webhook.
  - New **Commands** dialog (new "Commands" button per row) holds the
    raw ADMS command tool - send a command, view delivery/ACK history.
- The Devices list's Webhook column no longer shows the URL at all, not
  even masked - just whether a webhook is configured and, if so, whether
  it's enabled.

No backend changes - the admin API already supported partial device
updates, so this is purely an admin-UI reorganization.

## [2.8.1] - 2026-08-17

### Documentation

- Added a README disclaimer under "Telling the device its own timezone":
  a not-yet-claimed device's very first handshake structurally can never
  carry `TimeZone=` (there's no `Device` row - and so no configured
  timezone - until it's claimed), so firmware with the clock-reset-on-
  connect quirk can end up with a wrong clock before an admin ever gets
  a chance to set the right timezone. Recommends claiming a device with
  its correct timezone *before* treating it as live, then restarting it
  immediately after claiming - the restart both forces the fresh
  handshake needed to actually deliver the corrected `TimeZone=`, and
  surfaces a wrong timezone choice immediately instead of via a later,
  unrelated reboot.

## [2.8.0] - 2026-08-17

### Added

- Hardcoded webhook templates: a "Use a template" picker in the device
  drawer's webhook section prefills URL, headers, and body template for
  common downstream systems, using the existing custom-headers/body
  machinery - everything prefilled stays fully editable, and only
  ALL-CAPS placeholder text (site URL, API key/secret) is left for the
  user to fill in. Code-only for now, not configurable from the admin UI:
  add a new template by creating a file under `src/webhooks/templates/`
  and listing it in that directory's `index.ts`; the UI reads whatever's
  registered there via the new `GET /api/admin/webhook-templates`.
- First (and for now only) template: **ERPNext / Frappe HR — Employee
  Checkin**, wired to the real `add_log_based_on_employee_field` push API
  (Frappe token-auth header, `employee_field_value`/`timestamp`/
  `device_id`/`log_type` body, `hrms` vs `erpnext` app-name note for
  older ERPNext versions) - see "Webhook templates" in the README for
  full setup steps.
- New `punch_time_frappe` placeholder: `punch_time`'s same digits
  formatted as `"YYYY-MM-DD HH:mm:ss.000000"`, the naive-timestamp string
  Frappe/ERPNext's REST API expects (`punch_time` itself is ISO8601,
  which Frappe doesn't accept for this field). Available in any custom
  body template, not just the ERPNext one.

## [2.7.0] - 2026-08-17

### Added

- `robots.txt` disallowing every crawler (`User-agent: *`, `Disallow: /`)
  - this is a backend service, nothing here is meant to be indexed by
  search engines or AI/LLM crawlers.
- `/` now redirects (301) to `/admin` instead of 404ing - nothing is
  actually served at the bare root path.

## [2.6.5] - 2026-08-17

### Documentation

- Rewrote the README's security section: try HTTPS first (many newer
  ZKTeco/eSSL devices support it - no caveats apply if it works), fall
  back to plain HTTP only if the device can't, with the existing
  private-LAN/VPN guidance now scoped specifically to that HTTP-fallback
  case instead of framed as universal. Reframed the per-device secret
  explicitly as security-by-obscurity (real, but not encryption).
  Corrected the previous absolute claim that device firmware "cannot do
  TLS" - true for many older units, not true in general.
- Added a "Hosted vs. self-hosted" section: this project is 100% open
  source with no differences between self-hosting and the free hosted
  instance at [adms.adrk.in](https://adms.adrk.in) (genuine usage free
  indefinitely, spam blocked, no uptime SLA), including a note that the
  platform-level super_admin account the multitenancy architecture
  requires is never used day-to-day there - every company is fully
  self-service and isolated.
- Generalized ZKTeco-specific wording throughout to reflect eSSL support
  (added in 2.5.0) and general ADMS-protocol compatibility: title, intro,
  the device-connection section (now mentions trying HTTPS and the eSSL
  `.aspx` endpoint variant), and two spots describing generic ADMS
  firmware behavior that were only worded as ZKTeco-specific.

## [2.6.4] - 2026-08-17

### Fixed

- The default timezone picker (in both the device create form and the
  Unregistered Devices claim row, added in 2.6.3) was hardcoded to
  `"Asia/Kolkata"`, but that name is an IANA alias of the canonical
  `"Asia/Calcutta"` - depending on the ICU version bundled with the
  browser/Node runtime, `Intl.supportedValuesOf("timeZone")` may only
  return one of the two. A default that doesn't match any real `<option>`
  silently falls back to the browser's default (the first item in the
  list, nowhere near IST) instead of erroring - caught live while
  verifying the claim flow: the picker showed `Pacific/Midway` selected.
  Now resolved dynamically against the actual option list.

## [2.6.3] - 2026-08-17

### Added

- The "Connect a device" onboarding card (Cloud Server URL instructions)
  now also shows on Unregistered Devices, not just Devices - the page a
  new company_admin actually lands on first while waiting for their
  device to show up.

### Changed

- Device timezone is now mandatory, required both when registering a
  device directly and when claiming one from Unregistered Devices (which
  gets its own timezone picker on the claim row now) - it's load-bearing
  for accurate punch-time conversion and the ADMS handshake `TimeZone=`
  fix, so "unset" was never really a safe default. Devices that existed
  before this requirement were one-time backfilled to `Asia/Kolkata`.

## [2.6.2] - 2026-08-17

### Changed

- Removed the `TimeZone=` line from the `getrequest` poll response
  (added speculatively in 2.5.2). Confirmed live, on a real
  eSSL SilkBio-101TC, that it wasn't needed: the handshake-only fix from
  2.5.1 works fine on its own - the device just needed a power cycle to
  re-trigger a fresh handshake. No reference ADMS implementation found
  ever puts `TimeZone=` in a getrequest response, so this was a
  reasonable guess that turned out to be a no-op. `getrequest` is back
  to its pre-2.5.2 shape: queued-command delivery only.

### Confirmed

- The `TimeZone=` handshake field (2.5.1) is now confirmed working live
  on real hardware, including the fractional-minutes encoding for
  half-hour zones like IST (`330`) - previously flagged as an unverified
  guess. See "Telling the device its own timezone" in the README,
  including the power-cycle note: some firmware only re-runs the
  handshake on boot/reconnect, so a newly-set timezone may not reach the
  device until then.

## [2.6.1] - 2026-08-17

### Fixed

- `devicecmd` ACK matching used `/ID=(\S+)/` to pull a command's ID out
  of the device's response body, but that only stops at whitespace, not
  `&` - on the body's own documented shape
  (`ID=<id>&Return=<code>&CMD=<...>`), it silently captured the ID plus
  every field after it as one string, matched no row, and got logged as
  "ack for unknown command id" even when the ID at the start was
  correct. Caught live while verifying the new command tool. Now
  `/ID=([^&\s]+)/`.

## [2.6.0] - 2026-08-17

### Added

- Manual raw ADMS command tool: a new "Send raw ADMS command" section in
  the device edit drawer (backed by `POST`/`GET
  /api/admin/devices/:id/commands`) queues an arbitrary command for
  delivery on the device's next `/iclock/getrequest` poll and shows
  whether/how it responds. Built after confirming, live against a real
  eSSL SilkBio-101TC, that the `TimeZone=` field from 2.5.1/2.5.2 is
  delivered correctly but silently ignored by that firmware - this
  exists to test what a given firmware actually understands (there's no
  complete public spec for this protocol) without needing direct
  database/shell access to the server.

## [2.5.2] - 2026-08-17

### Fixed

- The `TimeZone=` handshake fix from 2.5.1 only reached devices that
  repeat the full `GET /iclock/cdata` handshake regularly. Confirmed live
  against a real eSSL SilkBio-101TC that it does not - it lives almost
  entirely in the `GET /iclock/getrequest` poll loop instead, so the
  device never actually saw the fix. `TimeZone=<value>` is now also sent
  from `getrequest`, on every poll (not just once), so a device that
  drifts again for any reason self-corrects within one poll cycle.

## [2.5.1] - 2026-08-17

### Added

- Devices with a configured `timezone` now receive a `TimeZone=<value>`
  line in the ADMS handshake response (`GET /iclock/cdata`), telling
  firmware that resets its own clock on first network contact (observed
  on an eSSL SilkBio-101TC) what its clock/timezone should actually be.
  Mirrors a real, confirmed-working field from the reference project this
  codebase mirrors protocol behavior from
  (`github.com/saifulcoder/adms-server-ZKTeco`), which ships it commented
  out by default. See "Telling the device its own timezone" in the
  README for the value-encoding caveat (whole-hour offsets are
  confirmed-working; fractional-hour offsets like IST are a best-effort
  guess, unverified on real hardware).

## [2.5.0] - 2026-08-17

### Added

- Support for eSSL-firmware devices, which call the ADMS endpoints with
  an `.aspx` suffix (`/iclock/cdata.aspx`, `/iclock/getrequest.aspx`,
  ...) because eSSL's own ADMS server is ASP.NET-based. Every device
  route now accepts both the bare and `.aspx`-suffixed spelling -
  observed live from a SilkBio-101TC that was 404ing on every ping while
  an equivalent ZKTeco-branded unit worked. Same protocol otherwise.

## [2.4.1] - 2026-08-17

### Fixed

- Request logging now covers every connection, not just requests that got
  a complete response: each request logs at arrival (`[req]`, with client
  IP) as well as completion (`[res]`, with status + duration), and raw
  TCP connections + protocol errors log at the socket level (`[tcp]`) -
  so a device that opens a connection but never speaks valid HTTP (e.g.
  HTTPS against the plain-HTTP port, or garbage bytes) is visible too,
  instead of leaving no trace.

## [2.4.0] - 2026-08-17

### Added

- Console log of every incoming HTTP request (method, full URL, response
  status, duration), including requests that match no route at all.
  Previously a device pinging an unserved path - e.g. firmware that can't
  carry the company-slug prefix and calls bare `/iclock/cdata` - 404'd
  with zero trace in either the Raw Request Log or the server output.
  Watch with `docker compose logs -f server`.

## [2.3.1] - 2026-08-17

### Fixed

- Device status no longer gets stuck on "ONLINE" forever. It was written
  once to the database on first contact and never revisited, so a device
  that pinged once and then went silent stayed "ONLINE" indefinitely.
  Status (`UNKNOWN`/`ONLINE`/`OFFLINE`) is now computed from `lastSeenAt`
  at read time instead of stored - see "Device online/offline status" in
  the README. New `DEVICE_OFFLINE_THRESHOLD_MS` env var (default 5 min)
  controls how long after last contact a device still counts as online.
  The now-unused `Device.status` column and `DeviceStatus` enum are
  dropped from the schema.

## [2.3.0] - 2026-08-17

### Added

- Application version number, shown in the admin UI's sidebar footer.
  Served from a new public `GET /api/admin/version` endpoint, sourced
  directly from `package.json` so it can't drift out of sync.
- This CHANGELOG's forward-looking process: from this version on, every
  change bumps `package.json`'s version and gets an entry here, in the
  same commit.

## [2.2.0] - 2026-08-17

### Added

- `ADMS_MAX_BODY_SIZE` env var to configure the device request body size
  cap (was hardcoded to 5MB). An oversized payload is now acked `OK`
  (never rejected outright) but dropped and logged loudly, so a device
  can't wedge itself retrying an identical oversized payload forever.
  (`5db93f5`)

### Documentation

- Documented the ADMS response-code policy (`200`/`401`/`503`/`500`) and
  the fixes below in the README. (`8d60ec6`)

## [2.1.3] - 2026-08-17

### Fixed

- Unclaimed devices no longer silently lose punch/data batches sent
  before they're claimed - data-bearing requests now get a `503`
  (withheld ack, device retries on its own schedule) instead of a
  `200 OK` that quietly discarded the data forever. (`85c4c65`)

## [2.1.2] - 2026-08-17

### Fixed

- Punch ingestion is now a single atomic batch insert (was one insert per
  record with no transaction) and classifies DB errors: connection/unknown
  errors withhold the ack so the device retries, bad-data errors skip only
  the offending record(s) instead of the whole batch. (`657b9bd`)

## [2.1.1] - 2026-08-17

### Fixed

- Unhandled errors in async ADMS route handlers (e.g. Postgres briefly
  unreachable) no longer risk hanging the request or crashing the whole
  process. Every device-facing error response is now always plain text,
  never JSON, matching what ZKTeco firmware actually expects. (`f54eaa0`)

## [2.1.0] - 2026-08-17

### Changed

- `Device.deviceSecret` is now mandatory - every device must have a
  secret configured, closing the "device with no secret stays open to
  anyone" gap. (`0fcc531`)

## [2.0.6] - 2026-08-17

### Fixed

- Stopped logging a duplicate `UnregisteredDevicePing` row on every retry
  from a device that's already pending, once its `PendingDevice` row
  exists. (`056ac99`)

## [2.0.5] - 2026-08-17

### Fixed

- Fixed a race condition (TOCTOU) in pending-device registration: two
  concurrent first-contact pings for the same serial number could clobber
  each other's captured secret/company. Now enforced as an atomic
  compare-and-set at the database level. (`4162d1c`)

## [2.0.4] - 2026-08-17

### Fixed

- Fixed a cross-company data leak: a `company_admin` session with no
  company attached could be treated as "no filter" and see/act on data
  across every company. (`f9262ac`)

## [2.0.3] - 2026-08-17

### Fixed

- Removed the ability to edit a company's slug after creation - changing
  a live company's slug orphaned any device already pointed at the old
  device URL. (`ae121de`)

## [2.0.2] - 2026-08-17

### Fixed

- Company slug lookup in device URLs is now case-insensitive, so a stray
  capital letter typed into a device's keypad doesn't drop its ping into
  the unscoped bucket. (`e52914b`)

## [2.0.1] - 2026-08-17

### Fixed

- `/health` now performs a real database round-trip instead of just
  confirming the process is up; added a matching docker-compose
  healthcheck so orchestrators can tell when the server can't actually
  serve requests. (`fc29cb4`)

## [2.0.0] - 2026-08-13

### Changed (Breaking)

- **Product pivot: public self-service company signup.** Anyone can now
  sign up, creating their own company and becoming its first admin with
  no super_admin involved. Every device URL now requires a company slug
  prefix (`/:companySlug/:secret/iclock/...`), **replacing the old bare
  `/:secret/iclock` path entirely.** Not-yet-claimed devices are
  attributed to a company from first contact, so a company_admin can
  self-serve claiming their own pending devices. (`02d6279`)

## [1.4.1] - 2026-08-13

### Fixed

- Fixed the device timezone field in the device edit drawer. (`fd5b2d2`)

## [1.4.0] - 2026-08-13

### Added

- Per-device IANA timezone setting, used to compute each punch's real UTC
  instant (`PunchRecord.punchTimeUtc`) from the device's local wall-clock
  digits (which carry no timezone info of their own). New webhook
  placeholders: `punch_time_utc`, `device_timezone`. (`2b7648b`)

## [1.3.0] - 2026-08-13

### Added

- Per-device secret + pending-device registration flow: an unrecognized
  device pings in as "pending," carrying over whatever secret it's
  already sending, until an admin claims it into a company. (`3cdef33`)

## [1.2.3] - 2026-08-12

### Fixed

- Webhook status badge shows "N/A" instead of "pending" when a device has
  no webhook configured. (`fa26193`)
- Punches ingested before a webhook is configured no longer auto-send as
  a backlog burst the moment one is added later. (`fa26193`)

## [1.2.2] - 2026-08-12

### Fixed

- Fixed punch time display formatting in the admin UI. (`986a8f4`)

## [1.2.1] - 2026-08-12

### Documentation

- Added a security warning to the README. (`d684611`)

## [1.2.0] - 2026-08-12

### Added

- Responsive/mobile admin UI: off-canvas sidebar navigation on small
  screens, redesigned stylesheet with design tokens. (`8e12eb1`)

## [1.1.0] - 2026-08-12

### Added

- Delete (single + bulk) for punch records, raw data dump, raw request
  log, and unregistered devices. (`df98dd2`)

## [1.0.0] - 2026-08-12

### Added

- Initial release: multitenant ADMS push-protocol server for ZKTeco
  devices, with a full admin API + React admin UI (companies, devices,
  punch records, webhook delivery with retry and custom
  headers/body-template support, raw data/request logging, pagination
  throughout), Docker deployment. (`24804ea`)
