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
