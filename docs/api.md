# API reference

The API uses same-origin REST endpoints under `/api/v1`. Fastify generates an OpenAPI 3.1 document from the schemas attached to registered routes.

## Swagger UI

- Interactive documentation: `/api/docs/`
- OpenAPI JSON: `/api/docs/json`
- OpenAPI YAML: `/api/docs/yaml`

Swagger UI is served locally by the application. It does not send the API definition to Swagger's hosted validator.

## Implemented endpoints

| Method | Path | Purpose | Authentication |
|---|---|---|---|
| `GET` | `/api/v1/health` | Process health for local monitoring and container health checks | None; returns no private data |
| `GET` | `/api/v1/dashboard/status` | Whether weather, calendar, and photo integrations are configured or available | None in the initial foundation; returns status only |
| `GET` | `/api/v1/weather` | Cached current conditions, six hourly forecast entries, and cache freshness; Japanese locations include nearby JMA observations | None in the initial foundation |
| `GET` | `/api/v1/settings/weather` | Read the shared weather location and temperature units | None in the initial foundation |
| `GET` | `/api/v1/settings/weather/locations?query=...` | Search cities and postal codes with Open-Meteo geocoding | None in the initial foundation |
| `PUT` | `/api/v1/settings/weather` | Save a chosen place or current-device coordinates and temperature units | None in the initial foundation |
| `POST` | `/api/v1/weather/refresh` | Request a server-side refresh immediately | None in the initial foundation |
| `POST` | `/api/v1/integrations/google/connect` | Start Google OAuth and set a short-lived state cookie | Local-only until app authentication is implemented |
| `GET` | `/api/v1/integrations/google/config` | Read OAuth setup state and safe client-ID hint; never returns the secret | Local-only until app authentication is implemented |
| `PUT` | `/api/v1/integrations/google/config` | Save OAuth client ID/secret and redirect URLs in encrypted server storage | Local-only until app authentication is implemented |
| `GET` | `/auth/google/callback` | Validate OAuth state, exchange authorization code, encrypt credentials, and redirect | Google OAuth state cookie |
| `GET` | `/api/v1/integrations/google/status` | Read connection state and available/selected calendars without secrets | Local-only until app authentication is implemented |
| `PUT` | `/api/v1/integrations/google/calendars` | Choose calendars and refresh selected event cache | Local-only until app authentication is implemented |
| `GET` | `/api/v1/calendar/events` | Read sanitized upcoming events from the shared cache | Local-only until app authentication is implemented |
| `POST` | `/api/v1/integrations/google/refresh` | Request an immediate event sync | Local-only until app authentication is implemented |
| `DELETE` | `/api/v1/integrations/google/connection` | Revoke and remove the local Google connection and event cache | Local-only until app authentication is implemented |
| `GET` | `/api/v1/integrations/immich/status` | Read safe connection state, albums, photo count, and refresh time; never returns the API key | Local-only until app authentication is implemented |
| `PUT` | `/api/v1/integrations/immich/config` | Save the Immich URL and encrypted API key, then check the connection | Local-only until app authentication is implemented |
| `POST` | `/api/v1/integrations/immich/test` | Test saved Immich access and refresh selected photos | Local-only until app authentication is implemented |
| `GET` | `/api/v1/integrations/immich/albums` | List albums available to the saved Immich API key | Local-only until app authentication is implemented |
| `PUT` | `/api/v1/integrations/immich/albums` | Save selected album IDs and refresh the photo cache | Local-only until app authentication is implemented |
| `POST` | `/api/v1/integrations/immich/refresh` | Refresh selected album photo metadata immediately | Local-only until app authentication is implemented |
| `DELETE` | `/api/v1/integrations/immich/connection` | Remove the saved Immich key, album selection, and photo metadata cache | Local-only until app authentication is implemented |
| `GET` | `/api/v1/photos/slideshow` | Read the cached manifest of selected photos | Local-only until app authentication is implemented |
| `GET` | `/api/v1/photos/:id/image` | Stream an optimized Immich thumbnail after verifying selected-album membership | Local-only until app authentication is implemented |

## Contract rules

- Keep route schemas, response codes, summaries, and error responses next to Fastify route handlers so the generated OpenAPI stays aligned with runtime behavior.
- Put shared request and response validation in `packages/contracts` and reuse those types in the web client.
- Document only implemented behavior in the generated OpenAPI document. Add new paths as their handlers and authorization checks are implemented.
- All private endpoints and photo responses must require a valid session and server-side role checks before they are added.
- Never put OAuth tokens, Immich API keys, cookies, or secret values in examples, descriptions, logs, or schemas.
- Open-Meteo forecast requests run on the server immediately after saving a location and then every ten minutes; browser clients read the shared cache. For Japanese locations the server also reads current JMA AMeDAS observations and the JMA area forecast to improve current conditions and rain outlook.
- JMA data attribution is shown in the weather card. JMA notes that public website data can change or be delayed; it recommends a stable provider for time-critical or high-volume use.
- When a user explicitly chooses device location, the browser requests a city label from BigDataCloud's client-side reverse-geocoding endpoint. This lookup is not exposed as a server API route.
- Google Calendar uses a server-side OAuth code flow with one-time state plus an HttpOnly SameSite=Lax callback cookie. The app requests only calendar list and event read-only scopes. OAuth client credentials and refresh tokens are encrypted at rest with AES-256-GCM using a generated local master key. Event sync runs every five minutes and returns only title, calendar name, start/end, and all-day status for the next 14 days.
- Immich server URL and API key are configured in Settings; the key is encrypted at rest with AES-256-GCM and is never returned to the browser. The backend retrieves albums and selected album photo metadata, refreshes every ten minutes, and serves only selected-album thumbnails through a same-origin proxy. Requests do not follow redirects. Current Immich API documentation is at [api.immich.app](https://api.immich.app/); album assets are obtained through Immich's metadata search endpoint for compatibility with v3.
