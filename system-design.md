# TECHSHAN-HOME — System Design

> **Document status:** Design / planning only — **implementation has not been authorized or started**  
> **Last updated:** 2026-11-09  
> **Architecture revision:** v2 — Svelte frontend + Fastify API  
> **Product type:** Self-hosted, private, responsive home dashboard web application

## Document conventions

- **CONFIRMED** — explicitly chosen during the design conversation; do not change without discussion.
- **RECOMMENDED** — preferred engineering design, not yet finally approved.
- **OPEN** — requires a later decision, infrastructure discovery, or compatibility test.
- **FUTURE** — optional expansion, not included in the initial committed scope.

This document consolidates the TECHSHAN-HOME requirements, design decisions, recommendations, constraints, implementation considerations, and unresolved questions discussed so far. It is a **system design specification**, not a claim that the features already exist. The older "Haven" prototype was exploratory; TECHSHAN-HOME is the project name and the planned application is substantially more complete.

---

## 1. Executive summary

**TECHSHAN-HOME** is a beautiful, Apple-inspired, minimalist home dashboard hosted on the owner's existing server, alongside Immich and other self-hosted services. It is accessible using the owner's domain over HTTPS, both on the local network and from the public internet, after authentication.

It is **one shared application/dashboard** whose content and configuration are centralized. The visual layout adapts responsively to the device's screen size and orientation. It is **not limited to Amazon Echo Show 8**: it should work on desktops, laptops, tablets, phones, and smart displays with compatible browsers.

The initial dashboard consists of four principal modules:

1. **Clock and date** — attractive, prominent, live digital clock.
2. **Weather** — current conditions and hourly forecast, with source data refreshed every 10 minutes.
3. **Google Calendar** — selected calendars, upcoming events, and optional expanded calendar view.
4. **Immich slideshow** — images from designated Immich album(s), with a prominent photo-first presentation, transitions, and optimized image delivery.

Beyond those modules, the system must support a **login page**, trusted devices authorized without a fixed server-side expiration date (until revoked), a **web Settings/Admin interface for all routine application configuration**, role-aware access, server-side integrations, and a straightforward Docker-based deployment. **No `.env` file** should be required.

### 1.1 Confirmed decisions

| Area | Confirmed decision |
|---|---|
| Name | **TECHSHAN-HOME** |
| Product | **Full self-hosted web application**, not merely a standalone HTML page |
| Hosting | Existing private server, alongside Immich and other services |
| Devices | Phone, tablet, desktop, laptop, Echo Show 8 (3rd gen), other browser-capable displays |
| Dashboard model | **One shared dashboard configuration** across all devices |
| Responsive behavior | Same dashboard, automatically adapted to viewport and orientation |
| Visual direction | Apple-inspired minimalist, elegant design; Immich photos are prominent |
| Clock | Live clock/date |
| Weather | Weather including hourly forecast; refresh source data every 10 minutes |
| Calendar | **Google Calendar** |
| Photos | **Immich** slideshow |
| Network | Local network **and** internet using the owner's domain with HTTPS |
| Authentication | Login page; trusted device may remain authorized **until manually revoked** |
| Settings | All routine configuration through the web Settings page |
| Environment files | **No `.env` file** |
| Backend direction | Strong interest in **Fastify + Zod**; chosen as the preferred architecture in the latest discussion |
| Work stage | **Discuss/design only; do not implement until requested** |

### 1.2 Recommended choices still subject to final review

- Svelte 5 + Vite + TypeScript frontend; Fastify 5 + Zod 4 backend.
- Single modular-monolith backend which can serve the built frontend on the same domain and port.
- SQLite with Drizzle ORM and a compatible maintained SQLite driver.
- Better Auth, subject to compatibility testing, plus a custom trusted-device authorization extension.
- REST/JSON APIs, documented with OpenAPI; Server-Sent Events (SSE) for live updates with polling fallback.
- Docker Compose and the **existing** reverse proxy; never introduce another proxy unless needed.
- Separate photo cache, database, and protected key storage on persistent server volumes.
- A photo-first dashboard design with clock, weather, and calendar overlays; a more structured card layout could be an optional built-in view if later approved.

---

## 2. Goals, scope, and non-goals

### 2.1 Product goals

1. A calm, visually polished, touch-friendly home display that can run for long periods.
2. One universal design and configuration, rather than individually managed dashboards for every device.
3. Connect to existing Immich without altering Immich's database or media library.
4. Use Google Calendar through the official authorized API rather than collecting Google passwords.
5. Keep all integration credentials on the server, never inside browser-visible JavaScript.
6. Allow the owner to install/configure/manage the app entirely from intuitive web UI **after minimal infrastructure bootstrap**.
7. Work at home and remotely through one HTTPS URL.
8. Maintain security even with long-lived trusted-device authorization.
9. Minimize resource consumption on a server already running other applications.
10. Make upgrades, recovery, backups, and future extensions predictable.

### 2.2 Initial functional scope

- Responsive dashboard home page.
- Live clock/date with configurable format and timezone.
- Weather conditions and hourly forecast, with a 10-minute backend refresh.
- Google Calendar connection and display of selected calendars and events.
- Immich integration, selected album(s), slideshow, and image caching.
- Login, logout, persistent trusted device authorization, device revocation.
- Setup wizard, owner account, users/roles (subject to v1 rollout priority).
- Full Settings/Admin UI covering application settings and integration configuration.
- System health, connection tests, error states, and backup/restore design.
- Secure local and internet access via HTTPS.

### 2.3 Later possibilities — NOT confirmed initial requirements

- Smart-home controls/Home Assistant integration.
- Music controls, notes, shortcuts, timers, AI assistant.
- Additional calendar sources (CalDAV, ICS, iCloud).
- More complex widget marketplaces and arbitrary third-party plugins.
- Video slideshows.
- PWA installation/offline mode beyond baseline resilience.
- Fine-grained per-device display preferences or completely different layouts.

These features appeared as optional ideas in earlier prototypes/discussion; **do not treat them as committed scope**.

### 2.4 Non-goals

- Replacing or rooting the Amazon Echo Show operating system.
- Guaranteed permanent foreground/kiosk behavior in Amazon Silk.
- Migrating, duplicating, or changing existing Immich storage.
- Deploying a separate microservice per integration from day one.
- Kubernetes or other heavyweight infrastructure without demonstrated need.
- Making Google or Immich APIs directly accessible from client browsers.

---

## 3. User experience and responsive design

### 3.1 Visual language

- Apple-inspired minimalist appearance; restrained typography, polished spacing, subtle glass/frosted surfaces, rounded corners, soft shadows, high legibility.
- The Immich slideshow is a major visual element, not merely a tiny thumbnail widget.
- Clock remains readable from several meters away on a smart display.
- Current conditions and upcoming events are visually secondary to the clock/photo, but remain easy to find.
- Support light and dark appearance; dynamic background contrast and dimming for readability.
- Large, accessible touch targets; usable with a mouse, keyboard, touchscreen, and browser zoom.
- Use motion subtly; respect reduced-motion preferences.

**Layout mode remains OPEN:** the design image favored photo-first glass overlays. The exact placement, dimensions, and whether a dedicated split-screen layout is offered still need final approval. The design image is conceptual and must not be mistaken for a functional screen.

### 3.2 One shared configuration, not separate display profiles

The following are global by default:

- Dashboard widget selection, widget order, and shared layout rules.
- Theme and appearance.
- Weather location and units.
- Timezone/time format.
- Google Calendar source(s) and selected calendars.
- Immich albums and slideshow timing/transition settings.

Every logged-in device uses the **same configuration**. CSS determines how it is rendered at each viewport size.

Independent client behavior is still allowed without creating a different dashboard definition:

- One device may be showing a different slideshow image at a given moment.
- Each device can scroll or temporarily open an expanded calendar view independently.
- Separate login sessions and device connection states.
- Different display widths naturally cause different widget positions.

**There are no per-device widget profiles in the confirmed model.** The device registry exists for authentication, auditing, and revocation—not for separate visual settings.

### 3.3 Responsive layout principles

| Viewport/device category | Intended behavior |
|---|---|
| Small phones | Portrait-oriented stack, legible condensed clock/weather, swipe/scroll to other modules |
| Large phones | Compact adaptive cards, possible side-by-side sections where space allows |
| Tablet portrait | Grid layout balancing image and information |
| Tablet landscape / Echo Show 8 | Photo-first landscape screen, prominent time, readable weather and events |
| Laptop/desktop | Wider photo presentation and expanded calendar/weather information |
| Ultrawide | Controlled maximum content widths; avoid stretched text or tiny controls |

Breakpoints should depend on viewport measurements and component space, not browser or device model names.

**Echo Show 8 (3rd gen):** optimize and test at **1280 × 800**. Do not assume its browser offers full kiosk privileges, never sleeps, or returns to the dashboard automatically after a restart. The system works in Silk when it is open, subject to Amazon restrictions.

### 3.4 Display interactions

- Fullscreen-like clean dashboard view within the available browser surface.
- Tap weather to view more hourly details (RECOMMENDED).
- Tap calendar to open detailed events/calendar page (RECOMMENDED).
- Tap or swipe slideshow to go forward/back or pause (RECOMMENDED).
- A restrained Settings/Admin entry point, visible only to authorized roles.
- Consistent state and errors: loading, reconnecting, stale data, authorization failed, service unavailable.

### 3.5 Clock

- Client-side clock updates every second; optional seconds display.
- Shared timezone configured in Settings; default can be chosen at setup.
- 12/24-hour format, localized date/weekday.
- Use system/standard time APIs; ensure changes across midnight/DST are correct.
- Do not request server time every second; consider server time-offset check only if device clocks drift (OPEN).

### 3.6 Weather

- Current temperature, condition, icon, apparent temperature (if provided), and next 6–12 hourly forecast entries.
- Backend refreshes weather every **10 minutes**, rather than each browser querying the source.
- Weather is cached centrally and includes last-updated/validity information.
- Weather location is **shared**; owner configures city/coordinates, units, and timezone.
- Missing or failed updates show the last known values with a stale indicator; do not pretend stale data is live.

### 3.7 Google Calendar

- Show upcoming events, date/time, all-day events, and color-coded calendars.
- Support recurring events and multiple selected Google calendars.
- Admin connects the account and selects calendars; views are read-only for initial release (RECOMMENDED).
- Optionally offer expanded day/week/month views after interaction; exact UI scope OPEN.
- Administrative privacy option to hide event descriptions/locations or show busy-only text on shared displays (RECOMMENDED).
- All authorized dashboard viewers see the configured shared calendar data; no separate per-device calendar source.

### 3.8 Immich slideshow

- Select one or several albums through the Admin UI, ideally dedicated to public-in-home display use.
- Shuffle/chronological sequencing.
- Configurable slide duration (initial default: 10 seconds).
- Subtle transitions: fade initially; slide/slow zoom optional.
- Image fit: `cover` (fill/crop) or `contain` (show whole image), configurable globally.
- Preload the next few photos, avoid full-resolution downloads when preview sizes suffice.
- Refresh album membership periodically (initial recommendation: 10 minutes).
- Keep a bounded, private cache of allowed image previews.
- Cache failures should not break the main clock/weather/calendar interface.
- Photos must never be made accessible through unauthenticated, guessable static paths.

---

## 4. High-level architecture

```text
                    LOCAL NETWORK                   INTERNET
 Phone / Tablet / Desktop / Echo Show   Phone / Tablet / Desktop / other
                 \                              /
                  \       HTTPS (same URL)     /
                   v                          v
                home.<your-domain>  [example only]
                              |
                     Existing reverse proxy
                  (TLS termination / routing)
                              |
                       Private Docker route
                              |
           +------------------------------------------+
           | TECHSHAN-HOME: modular-monolith service   |
           |                                          |
           |   Svelte 5 + Vite frontend (static build) |
           |   Fastify API (REST, SSE, auth, settings) |
           |   Zod shared validation contracts        |
           |   Background sync/scheduling             |
           +------------------------------------------+
                |           |              |
                |           |              +---- Protected key file / secret store
                |           +------------------- SQLite + Drizzle ORM
                +------------------------------- Private photo preview cache
                              |
             +----------------+----------------------+
             |                |                      |
       Immich REST API  Google Calendar API     Open-Meteo API
       existing server  OAuth + event sync      10-minute refresh
```

### 4.1 Architectural style: modular monolith

**RECOMMENDED:** one logical backend application with explicit modules for auth, settings, weather, Immich, Google Calendar, photo cache, jobs, audit logs, and health diagnostics. This keeps the deployment manageable and avoids independent service/database coordination until the workload demands it.

**One runtime container is preferred initially.** Fastify can serve the compiled Svelte SPA and expose API endpoints on the same origin. A second worker process is optional only if future workload or reliability testing requires it.

### 4.2 Same-origin frontend and API

- Site served at a single HTTPS origin, e.g. `https://home.example.com`.
- SPA routes served by the frontend static fallback.
- Backend under `/api/v1/...`; Better Auth routes can use their own documented namespace.
- Same-origin requests simplify cookie-based sessions, CSRF protection, reverse proxy configuration, and OAuth callbacks.
- The frontend never obtains Google OAuth refresh tokens, Immich API keys, or the server encryption key.
- Separate external frontend hosting is unnecessary for this application.

### 4.3 Data access policy

- Browser to TECHSHAN-HOME only.
- TECHSHAN-HOME backend to internal Immich, Google Calendar, and weather provider.
- SQLite/file cache on server only.
- Every private API and photo response requires authentication plus permission checks.
- Avoid direct browser access to private Immich endpoints even if their URL is internet-accessible.

---

## 5. Preferred technology stack (v2)

**Versions are design targets, not instructions to blindly install the newest release.** Final exact versions and compatibility must be rechecked at implementation time and pinned in the lockfile.

| Concern | Preferred choice | Status / notes |
|---|---|---|
| Language | **TypeScript** | RECOMMENDED end-to-end |
| Frontend | **Svelte 5** | RECOMMENDED |
| Frontend build | **Vite** | RECOMMENDED; SPA instead of mandatory server-side rendering |
| Frontend design | **Tailwind CSS 4 + custom CSS** | RECOMMENDED; support older browsers with fallbacks |
| UI primitives | **Bits UI**; selective shadcn-svelte components | RECOMMENDED, after browser compatibility checks |
| Icons | **lucide-svelte** | RECOMMENDED |
| Backend | **Fastify 5** | Current preferred architecture; don't adopt prerelease major versions just for novelty |
| Validation | **Zod 4** | Request, response, settings, shared types |
| Fastify↔Zod | Compatible official/community type provider | OPEN: select after compatibility test |
| Runtime | Current supported **Node.js LTS** | Verify specific LTS and package compatibility when building |
| Database | **SQLite** | RECOMMENDED |
| ORM/migrations | **Drizzle ORM / Drizzle Kit** | RECOMMENDED |
| SQLite driver | **better-sqlite3** or vetted compatible alternative | OPEN final selection |
| Authentication | **Better Auth + custom trusted-device layer** | RECOMMENDED; assess integration and security carefully |
| HTTP API | **REST/JSON + OpenAPI** | RECOMMENDED |
| Live notifications | **SSE**, with polling fallback | RECOMMENDED |
| API docs | `@fastify/swagger` and optional Scalar API Reference | RECOMMENDED, admin/internal only |
| Scheduling | **croner** | RECOMMENDED; in-process with overlap protection |
| Logging | **Pino**, via Fastify | RECOMMENDED |
| Images | Immich preview API; **sharp** only if needed | RECOMMENDED |
| Form validation | Shared Zod schemas, optionally `sveltekit-superforms` **not applicable** if no SvelteKit | Use SPA-compatible form patterns |
| Security plugins | `@fastify/helmet`, `@fastify/rate-limit`, properly scoped cookies/security utilities | RECOMMENDED |
| Static files | `@fastify/static` | RECOMMENDED |
| Tests | **Vitest, Playwright, ESLint, Prettier, svelte-check** | RECOMMENDED |
| Package manager | **pnpm** with lockfile | RECOMMENDED |
| Packaging | **Docker Compose** + multi-stage image | RECOMMENDED |
| Proxy | Existing Nginx/NPM/Caddy/Traefik/Cloudflare setup | OPEN which is installed |

### 5.1 Why Fastify + Zod instead of SvelteKit-only backend?

This is the **latest preferred direction** after discussion:

- Fastify gives a dedicated, explicit API boundary and cohesive plugin/service structure.
- Zod provides shared request/response/configuration schemas and TypeScript inference.
- Svelte SPA doesn't need server-side rendering or public search indexing; most content is private and dynamic.
- Fastify can serve the static frontend and API from one container.
- The API remains available for potential future apps, clients, integrations, or native wrappers.

**Tradeoff:** SvelteKit full-stack would use fewer framework boundaries. The performance difference is unlikely to matter for a few displays. Choose Fastify for maintainability, API contracts, and modular integration—not benchmark marketing.

### 5.2 Fastify and Zod package selection

Baseline relevant packages:

- `fastify`
- `zod`
- `@fastify/type-provider-zod` **or** `fastify-type-provider-zod` (select **one**, after testing)
- `@fastify/swagger`
- `@scalar/fastify-api-reference` (optional)
- `@fastify/static`
- `@fastify/helmet`
- `@fastify/rate-limit`
- `better-auth` (integration must be validated)
- `drizzle-orm`, `drizzle-kit`, compatible SQLite driver
- `croner`, `sharp`, `pino`/Fastify logging

Avoid uncontrolled dependency growth. Verify Fastify major-version plugin compatibility; ensure Zod type providers correctly generate JSON Schema/OpenAPI descriptions (especially transforms/refinements); pin versions and test upgrades.

### 5.3 Deliberately not required at launch

- Redis, RabbitMQ, BullMQ, Kafka, or a distributed job infrastructure.
- MongoDB, Elasticsearch, or an extra PostgreSQL instance.
- GraphQL for the same-origin dashboard.
- Kubernetes or multiple microservices.
- Separate SvelteKit SSR server plus Fastify API by default.

These can be revisited if concrete scaling or functional needs arise.

---

## 6. Authentication, trusted sessions, users, devices

### 6.1 User requirement

**CONFIRMED:** a login page and **no fixed authorization expiration for a trusted device**, so that a particular device remains authorized until revoked. The owner should be able to manage and revoke devices from Settings. The login page should fit the same minimalist aesthetic.

**Important distinction:** "indefinite device authorization" does **not** mean an unchanging bearer token with infinite validity. That would increase the damage of theft and provide weak replay defenses.

### 6.2 Recommended mechanism

1. User signs in with username/password; MFA can be required for privileged roles.
2. If they deliberately choose **Trust this device**, the backend creates a unique trusted-device authorization record with **no scheduled server-side expiration**.
3. Browser receives carefully protected, refresh-capable credentials in `Secure`, `HttpOnly`, `SameSite` (appropriate), host-only cookies.
4. Short-lived access/session credentials are renewed as necessary; persistent refresh credentials rotate securely.
5. All persistent credential material is stored **hashed** on the server where possible.
6. Every refresh checks the authorization record's active/revoked state.
7. Replay/race handling must be designed carefully; suspicious reuse can trigger device revocation or reauthentication.
8. User can sign out the current device, revoke a chosen device, or sign out all devices.
9. Changing password/MFA/security settings requires recent reauthentication and may invalidate sessions based on policy.
10. Security-sensitive routes must check current server-side permissions, not trust only previously issued claims.

**Browser limitation:** Browsers may expire/clear cookies, cap their lifetime, erase storage, or reset. An idle device cannot automatically refresh credentials while the browser is not running; no web app can promise automatic login forever after any length of disuse. The server authorization may remain indefinite, but usable browser credentials are constrained by browser behavior. This tradeoff must be explained in the Settings UI.

**No client fingerprinting as sole identity:** device identifiers/user agents are useful for display but do not securely bind credentials to a physical device. Hardware-bound authentication/passkeys may improve security where supported; Echo Show Silk compatibility is OPEN.

### 6.3 Roles — recommended model

| Capability | Owner | Admin | Viewer | Display |
|---|:---:|:---:|:---:|:---:|
| View shared dashboard | Yes | Yes | Yes | Yes |
| View authorized photos/events | Yes | Yes | Yes | Yes |
| Configure dashboard | Yes | Yes | No | No |
| Manage Immich, Google, weather | Yes | Yes | No | No |
| Manage users and roles | Yes | No | No | No |
| Approve/revoke devices | Yes | Limited | No | No |
| Security policy / keys / backup | Yes | No | No | No |
| View sensitive system/audit data | Yes | Limited | No | No |

A minimum v1 could begin with Owner + restricted Display, with Admin/Viewer prepared in the schema, but that rollout is OPEN. Roles are permissions enforced on the backend, not only hidden buttons.

### 6.4 Interactive sign-in

- Route `/login` with clear username/password form.
- Optional MFA for owner/admin.
- Trust-this-device checkbox (**RECOMMENDED unchecked by default**, not yet decided).
- Optional ordinary finite-duration login if unchecked.
- Accessible error messages that do not reveal whether an account exists.
- Rate limits, account recovery policy, and audit logs.
- User sessions per browser/device and explicit logout.

### 6.5 Display pairing (recommended convenience)

Unattended touch displays can optionally use a restricted pairing flow:

1. Unpaired device opens `/pair` and shows a short-lived one-time code.
2. Owner signs in using a trusted phone/computer and approves the code in Admin → Devices.
3. The device gets a restricted Display authorization and opens the shared dashboard.
4. Device remains trusted until revoked, subject to browser credential retention.
5. Owner can rename/revoke it and see last-seen details.

Pairing codes must be single-use, rate-limited, expire quickly, and not expose any photos/events before approval. This is **recommended**, not a separate per-device UI profile.

### 6.6 Trusted device registry

For each trusted authorization store (where reasonable):

- Opaque device authorization ID and owner/user reference.
- Human-friendly device name; type/browser metadata for display only.
- Role/permissions granted to that session/device.
- Creation time, last seen, last successful refresh, last IP/approximate network context.
- Revocation status and reason/timestamp.
- Credential family/rotation metadata and replay-detection state.

Owner admin actions:

- Rename device.
- Revoke any one device (including remote stolen device).
- Revoke all devices except current (requires fresh authentication).
- Review sessions and suspicious sign-ins.

### 6.7 Better Auth integration boundary

**RECOMMENDED:** reuse Better Auth for account identity, passwords, MFA/passkeys where supported, and standard sessions. Build the indefinite **trusted authorization** extension separately, rather than modifying security internals without a defined interface. Verify Better Auth's Fastify integration, cookies, SQLite/Drizzle adapter, auth paths, and extension lifecycle against exact selected versions before implementation. If the integration cannot meet the security requirements safely, select an alternative established session design.

---

## 7. First-time setup and application configuration (no `.env`)

### 7.1 Confirmed configuration principle

**Every routine TECHSHAN-HOME setting must be manageable from the web Settings page. Do not require editing a `.env` file.** Examples: app title, timezone, weather location, Immich server URL/API key, Google OAuth details, selected albums/calendars, appearance, users, sessions, and cache settings.

This does **not** remove the need for basic infrastructure choices outside the app: Docker persistent volumes, port mapping/network connectivity, DNS, firewall, and reverse proxy/TLS setup. Those must be documented and diagnosable from the UI; the application cannot configure a third-party DNS provider or router before being reachable without separate integrations.

### 7.2 First-run wizard (recommended)

1. Bootstrap protection verifies the installation is being claimed by the actual owner; use local-only setup or a one-time console/bootstrap code. **Do not expose an unclaimed public signup page.**
2. Create first Owner account, securely hashed password, optional MFA.
3. Choose application's canonical HTTPS URL and validate reverse-proxy settings.
4. Connect Immich URL/API key; test connection; select albums.
5. Configure Google OAuth client credentials/consent and authorize Google Calendar; select calendars.
6. Choose shared location/timezone and weather units.
7. Choose appearance and slideshow settings.
8. Finish setup; protect Settings and APIs with role checks.

If an integration is unavailable, allow owner to finish setup with a clearly marked disconnected service and configure it later.

### 7.3 Settings persistence and secrets

- Plain non-sensitive settings stored in SQLite.
- Secrets (Immich API key, Google OAuth client secret, Google refresh tokens) encrypted at rest before storage in SQLite.
- A random master encryption key generated on first boot and stored in a **protected, persistent server file or OS secrets facility separate from the database**, not in `.env` and not in publicly served files.
- Key readable only by the server process; restricted ownership and permissions.
- If a backup is restored, its matching master key must be restored securely or credentials will need reconnection.
- Passwords hashed with Argon2id or another security-reviewed modern password hashing scheme (not reversible encryption).
- Secret values are masked on the UI and never re-sent to browser unnecessarily; changes/replacements have audit logs and may require reauthentication.

**Security caveat:** auto-generating a key on the same machine as the encrypted database improves separation and backup discipline but does not stop an attacker with full server filesystem access. Use an external key manager only if the threat model and infrastructure justify it.

### 7.4 Settings groups

| Section | Responsibilities |
|---|---|
| General | App title, language, timezone, default date/time formatting |
| Dashboard | Shared widgets, order, enabled/disabled states, layout, previews |
| Appearance | Theme, typography, contrast, glass styling, night dimming |
| Clock | 12/24h, seconds, date format |
| Weather | Location/coordinates, units, hourly forecast length, fetch schedule |
| Immich | Server URL, API key, connection test, albums, photo fit, shuffle, transitions, duration, cache |
| Google Calendar | OAuth setup, connect/disconnect, calendars, visibility, refresh, privacy choices |
| Authentication | Password/security rules, trusted session behavior, MFA policy |
| Users | Account roles, invite/create/disable, access review |
| Trusted Devices | Pair, name, revoke, audit last seen |
| Network | Canonical domain, HTTPS/proxy checks, trusted proxy diagnostics |
| Storage/Backup | Cache limits, backups, restore, retention |
| System | Service status, errors, logs, versions, migrations, updates |

Settings changes should be validated, applied transactionally where appropriate, and notify currently connected dashboards.

---

## 8. Google Calendar integration

### 8.1 Confirmed source

**Google Calendar** is the selected calendar source. The connection is configured **once by the owner** for the shared dashboard; a device does not sign in to Google independently.

### 8.2 OAuth design

- Official Google OAuth 2.0 authorization flow.
- OAuth client ID/secret entered in protected Settings; no `.env` requirement.
- Callback based on canonical HTTPS origin, e.g. `/auth/google/callback` (final path may change with auth framework).
- Exact redirect URI registered in Google Cloud; client setup still requires the owner to configure a Google Cloud project outside TECHSHAN-HOME.
- Request **minimum read-only** Calendar scopes appropriate to selected calendars and events.
- Store refresh/access credentials encrypted server-side; never send refresh tokens to clients.
- Handle token rotation, revocation, re-consent, API errors, and scope changes.
- Google OAuth testing/publishing and consent-screen rules must be reviewed; some external apps in Testing mode can have time-limited refresh tokens.

**Local prototype note:** the development build accepts OAuth client details in Settings and encrypts the client secret and refresh tokens on the server. Since owner authentication is not implemented yet, the server must remain bound to loopback and must not be exposed to other networks. The future authenticated setup flow will add owner-only authorization to these Settings actions.

### 8.3 Data synchronization

- Initial full sync of selected calendars and bounded relevant event ranges.
- Incremental sync tokens where supported; handle invalid/expired tokens by safe resynchronization.
- Synchronize about every five minutes (RECOMMENDED configurable rate), honoring Google API limits and retry headers.
- Cache normalized events in SQLite for responsive reads and temporary Google outages.
- Respect original event timezones, all-day events, recurring instances, cancellations, and updated/deleted events.
- Avoid uncontrolled event cache growth: bounded look-back and look-ahead windows plus cleanup.
- Dashboard receives only sanitized fields required for display.

### 8.4 Shared display/privacy policy

Because all devices show the same dashboard, calendar privacy needs central controls: selected calendars, whether description/location is shown, potentially a "busy only" presentation. Only Owner/Admin can change these settings. Viewer and Display roles cannot browse additional hidden Google data by manipulating API requests.

---

## 9. Immich integration and slideshow architecture

### 9.1 Integration security

- Access existing Immich using its official REST API; **never** read or modify its database directly.
- **RECOMMENDED:** create a dedicated Immich user/account with viewer access to deliberately chosen album(s), where the installed Immich version/permissions support it.
- Use an API key with the least privilege allowed by the installed version.
- Store API key encrypted on TECHSHAN-HOME server.
- Never expose it in browser storage, HTML, JavaScript bundles, API payloads, or logs.
- Admin can test Immich connection, select permitted albums, view sync status, and rotate credential.

### 9.2 Connection topology

Preferred when both containers share the appropriate network: access Immich using an internal Docker service name/address. If deployed on another host, use an internal/private endpoint. The user's existing Immich public domain may be used as fallback if it is the only reliable route, but internal access is more efficient.

**SSRF defense:** because an admin can configure a server URL, protect server-side requests against unexpectedly dangerous URLs or redirects; implement a controlled allowlist/trusted endpoint policy, connection test, and explicit owner confirmation for local endpoints.

### 9.3 Photo selection and delivery

1. Periodic album synchronization retrieves eligible asset identifiers and metadata.
2. Application creates a slideshow selection from allowed albums.
3. Photo backend requests Immich preview/thumbnail images, not full originals by default.
4. Optional `sharp` transformation creates appropriately sized formats only if required.
5. Cache stores bounded private previews on disk; metadata references live in SQLite.
6. Authenticated browser receives an authorized slideshow manifest and photo URLs from TECHSHAN-HOME.
7. Browser preloads next images and performs transitions locally.

Photo endpoints must validate that the requested asset is still within authorized selected albums. Revocation/removal needs cache invalidation and reasonable TTLs. For sensitive images, use restrictive caching headers; consider memory-only client cache vs long-term offline availability tradeoffs.

### 9.4 Slideshow settings (recommended defaults)

| Option | Starting recommendation |
|---|---|
| Source | One or more explicitly chosen albums |
| Duration | 10 seconds |
| Ordering | Shuffle |
| Transition | Fade |
| Image fit | Cover, with optional Contain |
| Preloading | Next 1–3 photos |
| Album membership refresh | 10 minutes |
| Playback behavior | Independent sequence on each device |
| Video | Not in MVP |
| Failure behavior | Continue cached images if safely authorized; show fallback if none |

These are recommendations and should be revisited in the final UI design. Photo caching must not silently retain unselected albums indefinitely.

---

## 10. Weather integration

### 10.1 Provider

**RECOMMENDED:** Open-Meteo, subject to current usage terms, API compatibility, and whether the deployment's usage is eligible under its license/tier.

### 10.2 Refresh and response design

- One shared weather location chosen by Owner/Admin; coordinates preferred to ambiguous city text.
- Current conditions and 6–12 hourly forecast entries.
- Backend fetch every 10 minutes (CONFIRMED cadence), not per client.
- On cold start, fetch promptly if no valid data exists.
- Show `lastUpdated`, timezone, units, and stale indicator.
- Cache response in SQLite; normalize provider-specific fields to internal weather DTO.
- Retry failures with exponential backoff and provider rate-limit awareness.
- Cache existing values during temporary provider/network failures.

The **hourly forecast interval** is distinct from **fetching fresh data once per hour**.

---

## 11. Database design

### 11.1 Choice and operations

**RECOMMENDED:** SQLite + Drizzle ORM. Best suited to a small self-hosted application with relatively infrequent writes and many dashboard reads. Use WAL mode, reasonable busy timeouts, foreign keys, controlled migrations, and supported SQLite builds. SQLite data must live on a properly supported persistent local filesystem, not an unreliable shared/NFS mount.

If future workloads demand multiple active app replicas, complex concurrent writes, or an external DB service, revisit PostgreSQL with a documented migration path.

### 11.2 Proposed logical schema

| Entity/table | Purpose and important fields |
|---|---|
| `users` | ID, login identity, display name, role, status, created/updated timestamps |
| `accounts` / auth tables | Better Auth-specific identities/credentials as required by chosen version |
| `sessions` | Standard authenticated sessions and metadata |
| `trusted_devices` | User link, name, permissions, created/last-seen/revoked timestamps |
| `trusted_credentials` | Token family, hashed secret, rotation metadata, replay state |
| `app_settings` | Versioned shared settings, theme, clock, dashboard, provider options |
| `integration_secrets` | Encrypted secret blobs with type, key version, updated timestamp |
| `immich_connections` | URL, connection status, last test, owner reference |
| `immich_albums` | Allowed album IDs and selection/order metadata |
| `immich_assets` | Asset IDs, eligible album mapping, metadata and modification state |
| `photo_cache_entries` | Asset/variant key, disk location, size, expiry, last access |
| `google_connections` | Account identity, scope metadata, sync status |
| `google_calendars` | Selected calendars, color, visibility, sync state |
| `calendar_events` | Normalized event IDs, times, flags, sanitized display fields |
| `calendar_sync_state` | Per-calendar sync token, cursor/checkpoint, last success |
| `weather_cache` | Location/key, normalized forecast, fetch/expiry status |
| `scheduled_jobs` | Job ID, last/next execution, attempt/error state, overlap lock |
| `audit_logs` | Actor, action, target, result, timestamp, safe context |
| `schema_migrations` | Applied schema migration records |

Actual Better Auth tables and indexes depend on its validated adapter and must not be invented before library selection. Integration secrets should not be included in generic audit diffs.

### 11.3 Data lifecycle

- Central global settings with an explicit schema version and safe migrations.
- Cache entries have independent TTL and size retention policy.
- Calendar events limited to a sensible window and pruned.
- Stale photo metadata removed when albums/assets disappear.
- Session revocation records retained for a defined security/audit period.
- Transactions for multi-table state changes and migrations.
- Backups use SQLite-safe snapshot/backup procedures; never copy a live file casually without accounting for WAL.

---

## 12. Fastify API design

### 12.1 Principles

- Version public-internal API namespace: `/api/v1`.
- JSON request/response bodies; standardized success and error envelopes where useful.
- Zod validation at every input boundary and output schemas for sensitive endpoints.
- TypeScript types derived from schemas, not duplicate hand-maintained interfaces.
- Server-side role/access validation for every private route.
- Same-origin, cookie-based browser auth; CSRF protection for mutating endpoints.
- Request IDs, structured logs, pagination for lists, explicit resource-not-found/unauthorized errors.
- Standardized cache headers for data and images, avoiding private-data leaks.
- OpenAPI generated from compatible route schemas; published only to appropriate authenticated roles or development environments.

### 12.2 Proposed API surface

| Method | Route | Access | Responsibility |
|---|---|---|---|
| `GET` | `/api/v1/dashboard` | Any authorized viewer | Sanitized shared dashboard config + status |
| `GET` | `/api/v1/weather` | Any authorized viewer | Cached current/hours + freshness |
| `GET` | `/api/v1/calendar/events` | Any authorized viewer | Selected normalized events |
| `GET` | `/api/v1/photos/slideshow` | Any authorized viewer | Eligible photo sequence/manifest |
| `GET` | `/api/v1/photos/:id/image` | Any authorized viewer | Authorized optimized photo |
| `GET` | `/api/v1/events` | Any authorized viewer | SSE notifications |
| `GET` | `/api/v1/settings` | Admin/Owner | Full settings, secrets masked |
| `PATCH` | `/api/v1/settings` | Admin/Owner | Validated shared configuration updates |
| `POST` | `/api/v1/integrations/immich/test` | Admin/Owner | Test configured Immich endpoint |
| `GET` | `/api/v1/integrations/immich/albums` | Admin/Owner | Selectable albums |
| `POST` | `/api/v1/integrations/google/connect` | Admin/Owner | Start Google OAuth flow |
| `GET` | `/api/v1/integrations/google/status` | Admin/Owner | OAuth/sync state, no secret values |
| `POST` | `/api/v1/integrations/google/sync` | Admin/Owner | Request safe manual sync |
| `GET` | `/api/v1/devices` | Owner / authorized Admin | List devices and sessions |
| `PATCH` | `/api/v1/devices/:id` | Owner / authorized Admin | Rename/update safe device metadata |
| `DELETE` | `/api/v1/devices/:id` | Owner / authorized Admin | Revoke trusted device |
| `GET` | `/api/v1/users` | Owner | Manage access |
| `GET` | `/api/v1/system/status` | Admin/Owner | Service and integration health |
| `POST` | `/api/v1/system/backup` | Owner + recent auth | Start controlled backup |
| `GET` | `/health/live` | Internal/proxy | Minimal process liveness |
| `GET` | `/health/ready` | Internal/proxy | Safe readiness (no credentials/data) |

Authentication sign-in/out/session routes may be provided by Better Auth under its expected namespace rather than manually duplicating it in `/api/v1`.

### 12.3 Event push model

SSE emits minimal notifications, e.g. settings changed, weather refreshed, calendar synced, slideshow album changes, device revoked, or server reconnect. Clients **refetch the authoritative API data** rather than trusting event payloads to contain sensitive complete records.

- Automatic reconnect with exponential backoff.
- Heartbeats and reverse-proxy idle timeout configuration.
- Polling fallback for embedded browsers that do not reliably retain SSE connections.
- A missed notification is not fatal: browser refresh/reconnect refetches the latest global configuration.
- Forced logout/revocation is enforced at API request time, not solely by receiving an SSE signal.

---

## 13. Background jobs and synchronization

### 13.1 Proposed schedule

| Task | Starting frequency | Notes |
|---|---|---|
| Clock ticks | 1 second, browser-local | Not a network job |
| Weather fetch | **Every 10 minutes** | Confirmed frequency |
| Google Calendar sync | Every 5 minutes | Recommendation; API-aware |
| Immich album scan | Every 10 minutes | Recommendation; incremental if possible |
| Slideshow image change | 10 seconds, browser-local | Adjustable global setting |
| Photo cache cleanup | Daily | Bound disk usage |
| Backup | Daily by default | Configurable retention/destination |
| Health checks | Continuous / interval | Internal readiness/monitoring |

### 13.2 Scheduler rules

- Jobs persist last success/error timestamps and do not overlap themselves.
- Startup reconciles missed/expired work and starts necessary fetches without a request storm.
- Retry network failures with jitter/backoff and safe upper bounds.
- Respect external API quotas and transient HTTP errors.
- Avoid duplicate schedulers if deploying more than one app process; initially **one instance**.
- Background jobs are not triggered independently by every connected dashboard.
- Expose integration health and manual refresh controls via protected Settings.

---

## 14. Domain, HTTPS, local and remote networking

### 14.1 Confirmed access model

**Both local and internet access through the user's own domain over HTTPS.** A conceptual URL is `https://home.yourdomain.com` (replace with actual domain later).

- Use one canonical HTTPS hostname both at home and away.
- Prefer the **existing** reverse proxy (exact product presently unknown).
- Local split DNS can map the same hostname to the LAN reverse-proxy address where practical.
- Where split DNS is not available, router hairpin NAT or an existing tunnel/proxy route may be used after checking actual network behavior.
- TLS certificates must be valid for the public hostname, including local use.
- Only the reverse proxy is publicly exposed; private Fastify/SQLite/internal Immich ports are not opened to the internet.
- Configure trusted proxy headers conservatively; do not trust arbitrary Internet-supplied `X-Forwarded-*` headers.

### 14.2 Deployment path options

- Public DNS + router firewall/port forwarding + reverse proxy, **if** reachable and securely configured.
- Existing Cloudflare Tunnel or comparable approach if already used or if CGNAT/inbound rules prevent direct access.
- Prefer infrastructure reuse and minimal change to other running services.

**OPEN:** actual domain, reverse proxy product, Docker networks, server OS/hardware, existing Immich endpoint, CGNAT/port forwarding, local DNS. These must be discovered before final deployment instructions.

### 14.3 HTTPS and browser security

- Valid TLS, HTTPS redirect, secure cookies and appropriate HSTS once routing is confirmed.
- Strong content-security policy, frame policy, referrer policy, no unsafe script injection.
- CSRF protection, origin checks, controlled CORS (prefer same origin).
- Session cookies scoped to TECHSHAN-HOME hostname, **not** parent domain shared with other apps.
- Avoid mixed-content photo URL loading; backend relays private previews on the same HTTPS origin.
- Secure handling of OAuth callback through proxy, with correct canonical origin.

---

## 15. Operational security and privacy

### 15.1 Threats to address

| Risk | Required mitigation |
|---|---|
| Stolen browser credential | Credential rotation, server-side authorization/revocation, replay detection, secure cookies |
| Lost trusted screen | Device revocation, restricted Display role, no admin token on display |
| Malicious internet login traffic | Rate limiting, password policy, MFA option, monitoring |
| CSRF | CSRF tokens and/or strict origin validation on state-changing routes |
| XSS | Input/output encoding, CSP, no untrusted HTML insertion, restrictive script policy |
| Unauthorized photo access | Authenticated image endpoints and album allowlist; private cache |
| Leaked Google/Immich secrets | Encrypt server-side, mask in UI, no browser/log exposure, key separation |
| SSRF from configured Immich endpoint | Endpoint validation, redirect/IP policy, owner-restricted edit operation |
| User privilege escalation | Server-side RBAC for every private endpoint |
| Setup takeover | One-time bootstrap enrollment restricted to real owner |
| Sensitive calendar disclosure | Shared-display privacy options; only selected calendars/fields |
| Compromised backup | Backup encryption/access control, defined retention, recovery test |
| Dependency supply chain | Pinned lockfile, advisories, routine maintenance, minimal dependency set |

### 15.2 Sensitive operations

Require recent password/MFA verification before rotating master credentials, resetting sessions, adding owners/admins, changing critical network/security settings, exporting sensitive data, or restoring backups.

### 15.3 Logging and audit

- Fastify/Pino structured application logs, request IDs, sanitized failure details.
- Audit events for sign-in, device authorization/revocation, integration connection, permission changes, backup restore, and sensitive settings changes.
- Redact secrets, cookies, authorization headers, calendar private descriptions, and photo contents.
- Limit retention and expose only necessary diagnostics to administrators.

---

## 16. Deployment, updates, backups and recovery

### 16.1 Deployment design

- Standalone Docker Compose project; does not alter Immich compose stack.
- Multi-stage build: frontend built with Vite; Fastify server runs compiled output.
- Non-root container user, health checks, sensible resource limits, restart policy.
- One private app listener published only to the existing proxy's Docker network/private interface.
- Persistent volumes for SQLite, encryption key storage, and preview cache.
- No `.env` file. Docker infrastructure settings use documented defaults/Compose configuration, while routine app settings are administered in UI.
- Versioned image tags and pinning; avoid untested `latest` upgrades.

### 16.2 Application startup

1. Verify/create protected persistent data directories and master key.
2. Open SQLite, verify required pragmas/schema state, apply safe migrations.
3. If no owner exists, enter protected bootstrap mode.
4. Start Fastify/API/static frontend serving.
5. Start scheduler and run initial integration health checks.
6. Serve dashboard; use cached content while integrations initialize.

### 16.3 Backup requirements

- Use SQLite-safe online backup/snapshot and verified integrity.
- Persist global settings, users, session policy/metadata, Google/Immich connection data, and key material in a recoverable secure process.
- **Never** include unencrypted secret files in public/static artifacts or general debug exports.
- Document how the master key and encrypted database must be restored together.
- Photo previews may be regenerated; backups can omit cache to save space.
- Keep versioned backups and periodically test restore procedure.
- Upgrades should create pre-migration backup and support rollback where schema compatibility allows it.

### 16.4 Failure behavior

| Failure | Intended behavior |
|---|---|
| Internet outage | Existing page/clock continue; show cached API results if already loaded |
| Weather provider unreachable | Last cached forecast + stale notice |
| Google token revoked | Cached events where appropriate + admin reconnect warning |
| Immich unavailable | Previously cached/loaded permitted previews + missing-service notice |
| TECHSHAN-HOME server restart | Browser reconnects and refetches data/session |
| Database unavailable/corrupt | Fail safely; do not bypass authentication; health status signals problem |
| Trusted device revoked | Subsequent private API requests denied; browser returns to login/pair screen |
| Silk browser returns to Alexa Home | User reopens saved TECHSHAN-HOME URL; cannot force OS-level override |

---

## 17. Suggested repository layout

```text
TECHSHAN-HOME/
├── apps/
│   ├── web/                         # Svelte 5 + Vite SPA
│   │   ├── src/
│   │   │   ├── routes-or-views/      # Dashboard, Login, Setup, Calendar, Admin
│   │   │   ├── components/          # Clock, Weather, Calendar, Slideshow
│   │   │   ├── features/            # Cohesive frontend feature modules
│   │   │   ├── stores/              # Shared UI state
│   │   │   ├── services/            # Typed API client / SSE
│   │   │   └── styles/              # Design tokens / responsive CSS
│   │   └── ...
│   └── server/                      # Fastify API / static site hosting
│       ├── src/
│       │   ├── plugins/             # Fastify plugins / auth / security
│       │   ├── modules/
│       │   │   ├── auth/
│       │   │   ├── devices/
│       │   │   ├── settings/
│       │   │   ├── weather/
│       │   │   ├── calendar/
│       │   │   ├── immich/
│       │   │   ├── photos/
│       │   │   └── system/
│       │   ├── db/                  # Drizzle schema/migrations/access
│       │   ├── jobs/                # Scheduler / sync lifecycle
│       │   └── security/            # Encryption / authorization helpers
│       └── ...
├── packages/
│   └── contracts/                   # Shared Zod schemas / typed DTOs
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── compatibility/
├── docs/
├── Dockerfile
├── compose.yaml
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── README.md
```

This is a suggested organizational outline only; do **not** create these app files during the current design phase. The exact routing approach depends on the SPA router chosen for the frontend.

---

## 18. Testing and acceptance criteria

### 18.1 Automation and quality tools

- **Vitest:** validation, domain logic, sync workers, security utilities.
- **Fastify inject/testing:** APIs with no external listen port, access control and error cases.
- **Playwright:** login, settings, Google redirect stubs, Immich slideshow with fixture server, responsive layout tests.
- **svelte-check + TypeScript:** compilation/type consistency.
- **ESLint + Prettier:** maintainability/style.
- **Accessibility checks:** keyboard, focus, contrast, screen-reader semantics, motion settings, touch targets.
- **Dependency/version checks:** planned updates, reproducible builds, security advisories.

### 18.2 Required viewport/device tests

- Small phone portrait and landscape.
- Standard phone, tablet portrait and landscape.
- Echo Show 8 **1280 × 800** in Amazon Silk, on actual hardware if available.
- Desktop (common 1080p/1440p sizes) and ultrawide.
- Interaction with touch, mouse, keyboard, reduced-motion settings.
- Slow network, disconnection, reconnect, idle/resume, and browser restore.

Playwright's browser emulations are useful but are **not** a substitute for actual Silk testing. Advanced CSS effects and browser storage/session behavior may differ on the Echo Show.

### 18.3 Acceptance criteria for initial release

- Dashboard renders with one shared global config across devices, without per-device profiles.
- Clock stays accurate and readable; weather refreshes every 10 minutes on server and clients receive fresh values.
- Google Calendar can be authorized once in Settings, and selected events appear to authorized displays.
- Immich album selection controls eligible slideshow photos; original Immich credentials never appear in client requests.
- Owner can log in, mark a device trusted, close/reopen browser and remain signed in when its secure credentials survive.
- Owner can revoke a device and prevent future private API/photo access.
- No routine setup requires `.env` editing; app can be configured using protected Settings pages.
- Both local and remote access use a working HTTPS hostname.
- Failed integrations show honest status and usable cached content where safe.
- Backups, schema migrations, and restore are tested.
- No unintended impact on existing Immich/other containers.

Performance goals (e.g., smooth transitions, responsiveness and startup time) should be set using measurements on representative hardware rather than claimed before testing.

---

## 19. Proposed project milestones (implementation later)

1. **Foundation and security:** repo/toolchain, Fastify + Zod API, SQLite migrations, owner bootstrap, sessions/trusted devices, static Svelte frontend, protected Settings.
2. **Core dashboard:** responsive Apple-inspired layout, clock, weather, shared configuration and SSE/poll fallback.
3. **Integrations:** Immich connection/album selection/photo cache and Google Calendar OAuth/sync/cache.
4. **Administration:** complete settings pages, users/device registry, connection tests, preview, audit/system status.
5. **Production hardening:** Docker, proxy/HTTPS, backup/recovery, browser compatibility, performance/security tests, documentation.

These milestones are **not work that has started**. They are a proposed future execution order to review after system design is complete.

---

## 20. Open questions and decisions still needed

| Topic | Status | Question / tradeoff |
|---|---|---|
| Final visual layout | OPEN | Photo-first overlay only, split layout, or switchable modes? Exact wireframes? |
| Domain | OPEN | Actual domain/subdomain and TLS/DNS ownership? |
| Reverse proxy | OPEN | Existing Nginx Proxy Manager, Nginx, Caddy, Traefik, tunnel, etc.? |
| Server environment | OPEN | OS, Docker setup, available resources, networks, current Immich URL/version? |
| Owner security | OPEN | MFA mandatory for Owner or strongly recommended? Recovery mechanism? |
| Trust checkbox | OPEN | Unchecked by default (recommended) or preselected? |
| Roles rollout | OPEN | Ship all four roles initially or Owner + Display first? |
| Device pairing | RECOMMENDED | Ship pairing flow initially or after password-based login works? |
| Browser cookie strategy | OPEN | Session/refresh lifetimes, rotation and idle recovery measured against Silk browser behavior |
| Calendar privacy | OPEN | Show title/location, optionally busy-only? Which calendars? |
| Google OAuth | OPEN | Cloud project/consent screen publishing status, supported refresh-token lifecycle |
| Weather | OPEN | City/coordinates, temperature units, timezone, number of hours in strip |
| Immich access | OPEN | Dedicated viewer account/API privileges in user's Immich version; album choice |
| Slideshow defaults | OPEN | Seconds, shuffle, transitions, crop behavior and fallback photograph |
| Database storage | RECOMMENDED | SQLite location, backup destination and retention |
| Master key management | RECOMMENDED | Protected persistent key file vs existing secret manager; backup/recovery UX |
| API type provider | OPEN | Verify current supported Fastify/Zod provider and OpenAPI compatibility |
| Auth library | OPEN | Validate current Better Auth↔Fastify↔Drizzle compatibility and trust extension design |
| SPA routing | OPEN | Choose minimal stable frontend routing solution |
| Internationalization | FUTURE | Languages, date formatting options beyond browser locale |
| Night mode | RECOMMENDED | Dimming schedule or themes appropriate for always-on displays |
| Photo cache retention | OPEN | Cache size, TTL and policy when albums/permissions change |
| PWA | FUTURE | Installable mobile/desktop app shell and safe offline strategy |
| Browser availability | OPEN | Confirm Amazon Silk limitations and exact compatibility on physical device |

---

## 21. Architecture decision log

| ID | Decision | Status | Rationale |
|---|---|---|---|
| ADR-001 | TECHSHAN-HOME is self-hosted | **CONFIRMED** | Runs with existing services |
| ADR-002 | One shared responsive dashboard across devices | **CONFIRMED** | Central experience/configuration; no per-device profiles |
| ADR-003 | Immich supplies slideshow photos | **CONFIRMED** | Reuse personal media library |
| ADR-004 | Google Calendar is calendar source | **CONFIRMED** | Central calendar integration |
| ADR-005 | Weather source refreshed every 10 minutes | **CONFIRMED** | Keep the shared forecast reasonably fresh while fetching centrally |
| ADR-006 | Domain HTTPS available both locally and remotely | **CONFIRMED** | Unified secure access |
| ADR-007 | Login and indefinite trusted-device authorization until revocation | **CONFIRMED** | Convenience with revocable security |
| ADR-008 | No `.env`; routine configuration through web Settings | **CONFIRMED** | Usable administration experience |
| ADR-009 | Svelte 5 + Vite SPA, Fastify 5 + Zod 4 backend | **PREFERRED** | Clear API boundary and responsive UI |
| ADR-010 | Modular monolith, same-origin frontend/API | **RECOMMENDED** | Simple self-host deployment |
| ADR-011 | SQLite + Drizzle | **RECOMMENDED** | Lightweight persistence |
| ADR-012 | Better Auth + separate rotating trusted-device mechanism | **RECOMMENDED** | Mature identity features + custom persistent trust |
| ADR-013 | REST/OpenAPI + SSE with polling fallback | **RECOMMENDED** | Testable contracts and simple live updates |
| ADR-014 | Existing reverse proxy and Docker Compose | **RECOMMENDED** | Avoid disrupting other services |
| ADR-015 | Dedicated limited Immich user and server-side photo cache | **RECOMMENDED** | Privacy and performance |
| ADR-016 | Secrets encrypted in SQLite with a separate persistent master key | **RECOMMENDED** | No `.env`, secret separation |
| ADR-017 | Read-only Google Calendar in initial version | **RECOMMENDED** | Minimize permissions and complexity |
| ADR-018 | No coding before explicit go-ahead | **CONFIRMED** | User is still discussing design |

---

## 22. Reference documentation for later implementation

Authoritative documentation should be checked again when implementation begins; versions and integrations can change.

- Svelte: https://svelte.dev/docs
- Vite: https://vite.dev/guide/
- Fastify: https://fastify.dev/docs/latest/
- Zod: https://zod.dev/
- Tailwind CSS: https://tailwindcss.com/docs
- Bits UI: https://bits-ui.com/docs
- Drizzle ORM: https://orm.drizzle.team/docs/overview
- SQLite: https://www.sqlite.org/docs.html
- Better Auth: https://www.better-auth.com/docs/
- Google Calendar API: https://developers.google.com/workspace/calendar/api/guides/overview
- Google OAuth: https://developers.google.com/identity/protocols/oauth2
- Immich API: https://api.immich.app/
- Open-Meteo: https://open-meteo.com/en/docs
- Docker Compose: https://docs.docker.com/compose/
- OWASP Session Management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Authentication: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

---

## 23. Design handoff reminder

**Do not implement TECHSHAN-HOME yet.** Continue design conversations and update this document whenever a decision changes. Before beginning coding, review the OPEN decisions in Section 20, validate current dependency versions and integration compatibility, finalize interface mockups and API contracts, and confirm the owner's explicit instruction to start implementation.

**Bottom line:** TECHSHAN-HOME is planned as one secure, beautiful, universal dashboard with central configuration and trusted-device access, backed by a lightweight, self-hosted TypeScript/Fastify/Zod/SQLite stack that privately integrates Google Calendar, Immich, and hourly weather.
