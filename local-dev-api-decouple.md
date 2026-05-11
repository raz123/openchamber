# OpenChamber API/UI Decoupling Plan

This document captures the plan for separating OpenChamber UI clients from the API/server runtime. It is local development context and complements `local-dev-mobile-app-plan.md`.

## Goal

OpenChamber should support packaged and remote clients whose UI bundle is not served from the same origin as the API server.

This is not a throwaway v1/prototype track. Implementation should be incremental, but each slice should move toward the full production architecture: explicit runtime URL/auth layers, compatibility checks, secure remote-client credentials, API-only parity, Electron embedded UI behavior, and mobile-ready packaged-client assumptions. Avoid temporary shortcuts that would need to be unwound later unless they are explicitly documented as transitional and isolated.

The target PR should present the new architecture end-to-end, not just a small foundation layer. The PR scope is expected to include Electron loading bundled UI assets, the ability to connect that packaged UI to API-only instances, API-only server mode, runtime URL/auth plumbing, compatibility handling, and remote instance switching without loading remote UI pages.

Target clients:

- Hosted web/PWA, continuing to work same-origin by default.
- Future Capacitor mobile app with packaged HTML/JS/CSS connecting to a selected server URL.
- Electron with embedded packaged UI connecting to a local API-only server/sidecar over loopback.
- Headless/server installs that expose API without serving the full web UI.
- VS Code runtime, while preserving its bridge/proxy model instead of forcing it onto generic remote HTTP.

## Endgame

The endgame for this refactor is not only mobile. The stronger architectural target is:

- Electron ships and loads embedded UI assets from the app package, not from the web server's static UI output.
- Electron starts a local OpenChamber server as API-only over loopback.
- The embedded Electron UI talks to that local API-only server through the same runtime API/base URL contract as other packaged clients.
- Electron can switch from the local API-only server to remote OpenChamber API servers without loading remote UI assets as web pages.
- Hosted web remains available for browser/PWA use where the CLI-started web server serves both UI and API together.
- API-only/headless is an explicit option, not the default replacement for the web server's normal UI+API mode.
- Mobile becomes a natural extension of the same split: a packaged UI that connects to an API server, except the server is selected/paired remotely instead of auto-started locally.

If Electron reaches this model first, much of the mobile foundation becomes available automatically: runtime API base URL handling, packaged UI assumptions, API-only server behavior, explicit auth/connection boundaries, and raw/SSE/WebSocket URL construction all get exercised by a primary desktop runtime before Capacitor packaging begins.

## Non-Goals

- Do not rewrite the UI.
- Do not replace the existing runtime API abstraction wholesale in one step.
- Do not break hosted web, Electron, or VS Code while enabling packaged clients.
- Do not remove the normal CLI path that starts hosted web UI and API together.
- Do not make CORS/auth permissive just to make mobile development easy.
- Do not introduce Capacitor-specific APIs into shared feature code.

## Current State

- Hosted web mostly assumes same-origin API paths such as `/api/*`, `/auth/*`, `/health`, raw file URLs, SSE, and WebSocket endpoints.
- Desktop Electron starts the web server in-process and loads UI from loopback; this can remain same-origin/loopback for now.
- VS Code uses runtime APIs/bridge behavior and must remain a separate runtime contract.
- The new mobile web surface works as hosted web/PWA on iPhone, but a future packaged app cannot assume same-origin `/api` because its UI assets live inside the app bundle.
- Runtime URL/auth/fetch foundations are now in place in `packages/ui/src/lib/runtime-url.ts`, `runtime-auth.ts`, and `runtime-fetch.ts`.
- Transport-critical paths have moved onto the runtime URL layer: bootstrap health, OpenChamber SSE, global event WebSocket, terminal HTTP/SSE/WebSocket, and raw file/image URLs.
- Server compatibility metadata is exposed through `/health` and `/api/version`, and client compatibility evaluation exists in `packages/ui/src/lib/server-compatibility.ts`.
- Explicit API-only mode exists via `--api-only` / `OPENCHAMBER_API_ONLY=1`, with tested API-only static fallback behavior.
- `ui-auth` has a bearer client credential seam for future packaged-client auth while preserving current UI password/session behavior by default.
- Persistent remote client token runtime is implemented: server-side hashed client tokens, management endpoints, web RuntimeAPI plumbing, Settings token management, one-time token display, connection-link generation, QR generation, and Electron import/manual-token setup now exist.
- Electron packaged UI loading is implemented for packaged builds through `openchamber-ui://app`. In packaged mode Electron starts the local server API-only and injects API base URL/client token runtime config into bundled UI HTML before app scripts run.
- Electron no-navigation instance switching is implemented: switching changes the active API base URL/token in-process, recreates the OpenCode SDK client, remounts sync, resets config/projects state, and keeps the bundled UI loaded locally.
- Runtime-aware authenticated asset URLs now cover token-protected project icons and other asset-style URLs that cannot send `Authorization` headers directly.
- Electron remote instance compatibility now covers both connection-link/token instances and legacy UI-password-protected instances. Password login in bundled UI is treated as a bootstrap step to obtain or create a remote client token, then the runtime switches to bearer-token API auth rather than relying on cross-origin UI cookies.
- Electron runtime switching now has stable runtime identity keys (`local`, `host:<id>`, `ssh:<id>`, URL fallback) and per-instance active session memory with forced active-session rehydration after switch.

## Desired Architecture

Separate three concepts:

- UI origin: where HTML/JS/CSS are loaded from.
- API base URL: where HTTP API/auth/health routes live.
- Realtime base URL: where SSE/WebSocket connections live.

Hosted web defaults:

- UI origin: same browser origin.
- API base URL: same origin.
- Realtime base URL: same origin converted to `ws/wss` where needed.
- Startup mode: normal CLI web/server command serves UI assets and API routes together unless API-only is explicitly selected.

Packaged mobile defaults:

- UI origin: Capacitor local app origin.
- API base URL: user-selected server URL.
- Realtime base URL: derived from selected server URL.
- Auth: explicit token/session credential stored in secure storage.

VS Code defaults:

- UI origin: VS Code webview.
- API base URL: VS Code runtime bridge/proxy, not generic server URL unless intentionally implemented.

Embedded Electron defaults in the target architecture:

- UI origin: embedded packaged app assets.
- API base URL: local loopback API-only server started by Electron.
- Realtime base URL: derived from local loopback API base URL.
- Auth: local trusted desktop session or explicit local token, depending on the final server security model.

Electron remote-instance behavior in the target architecture:

- Keep rendering the local packaged Electron UI.
- Treat remote instances as API endpoints, not as remote websites to load into the BrowserWindow. User-facing UI should call these "Instances" rather than "API endpoints".
- Switching instances means changing the selected API base URL, reconnecting HTTP/SSE/WebSocket clients, and rehydrating runtime state.
- Native integrations remain controlled by the local Electron shell regardless of the selected server.
- Remote servers do not need to serve desktop UI assets for Electron clients, though hosted web UI can still exist for browsers.

This requires explicit server compatibility reporting. Packaged clients should check server version/capabilities before assuming endpoints or payload shapes are supported. A server that is too old/new/incompatible should produce a visible connection/version state, not broken UI behavior.

## Core Abstractions

Add a small runtime URL/config layer before changing feature behavior.

Suggested responsibilities:

- Resolve `apiBaseUrl` for current runtime.
- Build API URLs from paths without callers string-concatenating `/api`.
- Build raw asset/file URLs such as file previews/images.
- Build SSE URLs.
- Build WebSocket URLs using `http -> ws` and `https -> wss` conversion.
- Attach auth credentials consistently.
- Expose runtime metadata: hosted web, Capacitor mobile, Electron, VS Code.

The API should be boring and explicit, for example:

```ts
runtimeUrl.api('/api/fs/raw', { path })
runtimeUrl.health()
runtimeUrl.auth('/auth/device')
runtimeUrl.sse('/api/events')
runtimeUrl.websocket('/api/terminal/ws')
```

Exact names can differ; the important part is that feature code does not construct same-origin URLs directly.

## Inventory Targets

Audit and migrate these URL categories:

- Direct `fetch('/api/...')` calls.
- Direct `fetch('/health')` calls.
- Direct `/auth/...` routes.
- Direct raw file/image URLs such as `/api/fs/raw?path=...`.
- SSE/EventSource construction.
- WebSocket URL construction.
- Links that navigate to sessions or API-backed resources.
- Any service-worker fetch/cache assumptions around API routes.
- Any server-rendered or generated URLs used by notifications/deep links.

Runtime API modules should be preferred over ad hoc fetches. If a feature already uses `RuntimeAPIs`, keep that direction and move URL decisions into the runtime implementation.

## API-Only Server Mode

OpenChamber should support a clear server mode that provides API without full UI assets.

This must be opt-in. The existing web CLI mode should continue to start the hosted web experience with both UI and API. Decoupling UI and API internally must not force browser/PWA users to run two separate processes or lose the current one-command web server workflow.

Candidate interfaces:

```bash
openchamber serve --api-only
```

or:

```bash
OPENCHAMBER_API_ONLY=1 openchamber serve
```

API-only mode should provide:

- `/api/*` routes.
- `/auth/*` routes.
- `/health` and server status routes.
- SSE endpoints.
- WebSocket endpoints.
- Notification/push registration endpoints.
- Pairing/tunnel/auth endpoints when implemented.

API-only mode should not serve full web UI assets unless explicitly configured.

Hosted web mode should continue serving UI + API for normal browser/PWA use.

## Auth Direction

Packaged remote clients should not rely on same-origin cookies as the only auth model.

Important distinction:

- UI auth answers: is this user allowed to use the browser-served UI for this server?
- Client auth answers: is this packaged client allowed to call this server's API?

Today UI password/passkey auth is browser-oriented: `/auth/session` issues an HttpOnly `oc_ui_session` cookie for same-origin hosted UI/API access. That remains valid for hosted web/PWA and browser access protection, but it should not become the primary credential model for Electron/mobile packaged clients.

Target split:

- UI password protects browser UI access.
- Remote client tokens authorize packaged-client API access.
- Pairing tokens/codes are short-lived bootstrap credentials used to issue remote client tokens.
- UI password/session can gate management actions such as creating pairing codes, creating manual tokens, listing connected clients, and revoking clients.
- Packaged clients authenticate API/SSE/WebSocket calls through the runtime auth layer, not by navigating to remote UI pages to obtain cookies.

Required direction:

- Add or reuse explicit auth/session tokens suitable for remote clients.
- Store mobile credentials in secure storage in Capacitor.
- Support credential revocation from the server side.
- Keep hosted web compatible with existing auth behavior.
- Avoid logging tokens or sensitive pairing payloads.
- Treat QR/device pairing as the preferred mobile flow, but keep manual token paste/input as a first-class desktop Electron flow.

Open questions:

- Token format and lifetime.
- Whether mobile pairing uses OAuth/device flow, QR pairing, one-time token, or signed handoff.
- Whether API token and UI session token are the same credential.
- How server identity/fingerprint should be represented to users.
- Exact token lifetime/refresh UX for Electron remote instances where QR scanning is not convenient.

## CORS And Transport

CORS should be intentional, not blanket-open by default.

Rules:

- Hosted same-origin web should continue to work with no CORS complexity.
- API-only/remote server mode should allow configured trusted origins or packaged-client expectations.
- Development LAN mode can be permissive only when explicitly enabled and documented.
- Remote production servers should use HTTPS; WebSocket should use `wss` when API is `https`.
- Local trusted LAN HTTP may be useful for development, but UI/security docs should make that explicit.

## Runtime Parity Risks

Main pitfalls:

- Breaking Electron loopback same-origin assumptions.
- Accidentally routing VS Code bridge calls through generic HTTP.
- Forgetting raw file/image URLs used by Files, Markdown, diffs, or attachments.
- Building SSE/WebSocket URLs incorrectly under reverse proxies, tunnels, or HTTPS.
- Service worker caching API responses or old UI chunks in ways that hide base URL changes.
- Mixing auth strategies: cookies in one path, bearer/token in another, without a clear precedence policy.
- Letting mobile store a server URL but leaving some feature code hardcoded to `/api`.
- Letting packaged Electron load remote UI assets instead of reconnecting its local UI to a remote API endpoint.
- Missing API version/capability checks, causing packaged UI and remote server versions to fail in unclear ways.

## Version And Capability Compatibility

Packaged UI clients and API servers may be updated independently. This matters for Electron remote instances and Capacitor mobile.

Required direction:

- Server exposes version and capability metadata through `/health`, `/api/version`, or a similar stable endpoint.
- Packaged clients check compatibility before full bootstrap.
- UI can show explicit states: compatible, server too old, server too new, missing required capability, auth expired, unreachable.
- Feature code should prefer capability checks for optional server features rather than assuming every connected server has the newest routes.
- Hosted same-origin web can be more relaxed because UI and API usually ship together, but should not bypass shared compatibility helpers where packaged clients depend on them.

## Implementation Phases

### Phase 1: Inventory And Tests

Goals:

- Inventory all same-origin URL assumptions.
- Classify each by HTTP API, auth, health, raw asset, SSE, WebSocket, navigation, or service worker.
- Add focused tests where cheap for URL builders and runtime API implementations.

Output:

- A migration checklist of concrete call sites.
- A small set of URL-building tests before broad migration.

Status: mostly complete for transport-critical paths. URL/auth/fetch tests now cover relative hosted defaults, configured API/realtime bases, WebSocket conversion, bearer header behavior, and runtime fetch URL resolution. Remaining direct `/api/*` callers should be migrated by feature/runtime priority rather than as an unreviewed bulk replacement.

### Phase 2: Runtime URL Layer

Goals:

- Add centralized URL/config helpers.
- Preserve current hosted web behavior exactly by default.
- Support an explicit configured API base URL without turning it on broadly.

Output:

- Feature code can ask one place to build API/SSE/WebSocket/raw URLs.
- No behavior change for hosted web/Electron/VS Code.

Status: implemented. `createRuntimeUrlResolver`, `configureRuntimeUrlResolver`, `getRuntimeUrlResolver`, and `setRuntimeUrlResolver` exist. Default behavior preserves same-origin relative URLs. Web RuntimeAPIs now register the active resolver.

### Phase 3: Migrate Feature Callers

Goals:

- Replace direct same-origin fetch/raw/SSE/WebSocket construction with runtime helpers or `RuntimeAPIs`.
- Prioritize mobile-relevant flows first: chat bootstrap, sessions, files/raw images, git changes/diffs, notifications, settings/auth status.
- Keep diffs small and validate each slice.

Output:

- Packaged-client base URL can be simulated in web without obvious `/api` leaks.

Status: substantially complete for shared web/desktop runtime behavior. Completed high-risk transport/raw paths and broad feature callers: health/bootstrap, OpenChamber SDK/SSE, global WebSocket, terminal HTTP/SSE/WebSocket, Files/raw/image URLs, Git HTTP API, config/settings/quota/projects/session folder stores, providers/GitHub auth, MCP, skills/catalog, TTS/STT, scheduled tasks, themes, behavior settings, onboarding/recovery, desktop system/update calls, and project icon asset URLs. VS Code-only direct `/api/vscode/*` calls were moved behind VS Code RuntimeAPI methods. Remaining direct calls, if any, should be handled by focused review rather than bulk replacement.

### Phase 4: API-Only Server Mode

Goals:

- Add server mode that exposes API/auth/realtime routes without serving full UI.
- Keep hosted web mode unchanged.
- Document CLI/env behavior.

Output:

- Headless server can be used as a target for future packaged clients.

Status: implemented foundation. `--api-only` and `OPENCHAMBER_API_ONLY=1` skip static UI routes while preserving API/auth/realtime routes. API-only fallback route behavior has coverage in `static-routes-runtime.test.js`.

### Phase 4.5: Electron Embedded UI Migration

Goals:

- Package Electron UI assets inside the Electron app instead of loading the UI from the local web server.
- Start the local server in API-only mode from Electron.
- Point Electron's embedded UI at the loopback API base URL through the runtime URL/config layer.
- Support reconnecting the packaged Electron UI to a selected remote OpenChamber API server without loading that server's UI assets.
- Preserve the current Electron behavior from the user's perspective: app opens normally, local server auto-starts, native integrations still work.
- Avoid regressing hosted web mode; this is an Electron runtime packaging change, not removal of web-hosted UI.

Output:

- Electron proves the packaged-UI/API-only split in the primary desktop runtime.
- Mobile packaging can reuse the same client/server contract with fewer unknowns.

Status: implemented and locally smoke-tested for the local sidecar path and remote instance switching path. Packaged Electron registers `openchamber-ui://app`, serves files from bundled `resources/web-dist`, injects runtime API config before app bootstrap, and starts the in-process server with `apiOnly: true`. `bun run electron:dev:bundled` now exercises the same bundled-UI/API-only path in dev by building `resources/web-dist` and skipping Vite/HMR. The local API sidecar works from the bundled origin after adding desktop-only CORS and WebSocket origin allowance for `openchamber-ui://app`. Electron no-navigation instance switching is implemented by updating runtime API/token config in-process, recreating the OpenCode SDK client, remounting sync, and resetting projects before pulling settings from the selected instance. Local instance probing/new-window behavior was fixed for bundled UI so Local uses the sidecar origin for API checks while opening bundled UI windows instead of API-only JSON pages. New windows for remote instances now open bundled UI with per-window runtime API URL/token instead of navigating to remote UI pages. Stable runtime identity keys and per-instance active-session memory now preserve selected sessions across Local/Remote switches. Remaining work: complete broader end-to-end bundled Electron validation under streaming/permission/terminal load.

### Phase 4.6: Version/Capability Handshake

Goals:

- Add a stable server version/capabilities response for packaged clients.
- Teach packaged-client runtime bootstrap to check compatibility before starting full app flows.
- Add user-visible incompatible/unreachable/auth-expired states.

Output:

- Electron remote switching and future mobile pairing can fail safely when client/server versions do not match.

Status: mostly implemented for visible blocking states. Server reports `compatibility` metadata via `/health` and `/api/version`. Client-side evaluation returns explicit states for compatible, auth-required, unreachable, invalid response, server too old, client too old, and missing capability. Electron host probing uses `/api/version` and maps incompatible OpenChamber servers separately from unreachable or wrong-service targets. The Instance switcher, Direct Instance form, and desktop recovery flow now distinguish incompatible, wrong-service, unreachable, and auth-required states. Remote instance switching updates runtime API config without page navigation. Remaining work: include richer compatibility details in the blocking UI.

### Phase 5: Packaged Client Config

Goals:

- Add runtime config for selected server URL.
- Add connection state model: connected, connecting, unreachable, auth expired, incompatible.
- Store credentials appropriately per runtime.

Output:

- Future Capacitor app can select/connect to a server instead of assuming same-origin.

Status: implemented for Electron and reusable by future packaged clients. Runtime config can be injected at bootstrap and mutated at runtime. Direct Instances store selected server URL/token/label/default state for Electron. `openchamber://connect?v=1&server=...&token=...&label=...` payload helpers support import/export and are shared with CLI-generated links. Connection states now include reachable/auth-required/incompatible/wrong-service/unreachable handling through host probing and compatibility checks. Future mobile still needs platform secure storage and native deep-link handling.

### Phase 6: Auth, Pairing, And CORS Hardening

Goals:

- Implement explicit remote-client auth/token model.
- Add pairing flow, manual token entry, and revocation path.
- Tighten CORS and transport defaults.

Output:

- Secure enough foundation for real mobile app packaging.

Status: implemented for manual-token, connection-link, and legacy password bootstrap flows. Runtime bearer auth headers and `runtimeFetch` exist on the client. `remote-clients.json` stores hashed remote client tokens; `/api/client-auth/clients` supports list/create/revoke/purge-revoked behind UI auth; Settings exposes token creation/list/revocation/purge, one-time token display, connection-link export, and QR generation. Electron Direct Instances support manual token entry and import of `openchamber://connect?...` links. `ui-auth` accepts valid bearer client credentials for HTTP API flows and `oc_client_token` query credentials for SSE/WebSocket and authenticated asset URLs. For an existing remote instance that only has UI password protection, bundled Electron shows the local bundled login UI, then obtains/creates a remote client token and persists it back to the saved instance so subsequent switches use token auth. Desktop-only CORS/WebSocket origin allowance is scoped to the bundled Electron origin. Future mobile still needs native secure storage, deep-link handling, and QR/device pairing polish.

## Runtime Switch UI State Reference

Runtime switching must preserve user context without letting Local, Remote, SSH, or ad-hoc instances overwrite each other's transient UI state. The safe pattern is identity-first, then state restore, then bounded rehydration.

### Stable Runtime Identity

Do not key per-instance UI memory by raw URL unless there is no stronger identity.

Preferred keys:

- Local Electron sidecar: `local`
- Saved Remote Instance: `host:<desktopHost.id>`
- SSH-managed instance: `ssh:<instance.id>`
- Ad-hoc/custom URL fallback: `url:<normalized-origin-or-url>`

Rules:

- `switchRuntimeEndpoint()` must accept and dispatch `runtimeKey` and `previousRuntimeKey` separately from `apiBaseUrl`.
- Token handoff must not change `runtimeKey`. Password bootstrap may add a client token to a saved host, but the selected identity remains `host:<id>`.
- Local must resolve to `local` even before the first explicit switch. Do not let startup Local state use `url:http://127.0.0.1:<port>` and switch-back use `local`.
- URLs remain transport details. Runtime identity is a product/session boundary.

### Per-Instance Memory

Store small UI pointers per `runtimeKey`, not globally:

- active session id;
- active directory when it is part of selection semantics;
- draft target/open state if draft restore is desired;
- scroll/viewport anchor if the UI needs exact visual continuity.

Current implementation stores active session id in `session-ui-store` with `prepareForRuntimeSwitch(previousRuntimeKey)` and `restoreForRuntimeSwitch(runtimeKey)`, and also updates the memory immediately from `setCurrentSession()` so it does not rely only on switch timing.

When adding more state:

- capture it when the user changes it, not only during switch;
- restore it after runtime URL/auth has changed and SDK clients have been recreated;
- keep memory in narrow stores rather than broad global stores when the value changes often.

### Rehydrate, Do Not Trust Snapshots

After restoring active session id, the new runtime's sync store may only have session metadata or may still be bootstrapping.

Required behavior:

- Keep the restored session selected while bootstrap is loading or partial.
- Do not clear active selection just because one intermediate `sessions` snapshot does not contain the id.
- Force rehydrate the restored active session with a bounded retry (`syncSession(id, true)` or equivalent) until messages become renderable or attempts are exhausted.
- If the final completed bootstrap proves the session no longer exists, show a deliberate fallback state. Avoid automatic early draft selection during bootstrap races.

This prevents the common failure mode where the sidebar shows the restored session, the chat panel starts loading messages, then an intermediate list snapshot deselects it into a draft.

### Transient Live State

Live SSE/WebSocket state is not the same as historical session state.

Rules:

- On switch away, close/recreate the active realtime connection for the selected runtime.
- On switch back, reconnect and refetch current session status from the server.
- Do not infer live streaming forever from old client-only state.
- Do not share live streaming maps, pending permission/question UI, or abort prompts across runtime identities unless they are explicitly namespaced by `runtimeKey`.

Exact animation progress does not need to survive instance switches, but current server truth should restore: busy/idle state, latest messages, permission prompts, and active session content.

## Remaining Work Before PR Ready

- Complete extended bundled Electron manual validation with token-protected and password-bootstrap remote instances: Local startup, Local -> remote switch, remote -> Local switch, projects/sessions/settings refresh, active session restore, chat send/stream, git status/branches, terminal/realtime, permission/abort, Direct Instance import, project icons, and new-window behavior.
- Continue validating runtime switch under live streaming and permission flows. The selected session now restores per instance and force-rehydrates messages, but exact live animation state is intentionally reconstructed from server state rather than preserved byte-for-byte.
- Surface richer compatibility details in blocking UI instead of only generic incompatible/unreachable status.
- Run full `bun run build` before PR creation. `bun run type-check`, `bun run lint`, and targeted tests have passed after recent slices.

## Implementation Progress Log

- Added runtime URL resolver and tests for hosted-relative defaults, configured API/realtime bases, raw file URLs, and WebSocket conversion.
- Added runtime auth/fetch skeleton and tests for bearer headers and `/api`/`/auth`/`/health` URL resolution.
- Migrated transport-critical client code to runtime URL helpers: bootstrap health, SSE, global WebSocket, terminal transports, and raw file previews.
- Added server compatibility metadata and client compatibility checker.
- Added API-only server mode and static fallback tests.
- Added `ui-auth` bearer client credential seam with tests while keeping default UI password behavior unchanged.
- Added persistent remote client token runtime with hashed tokens, create/list/revoke endpoints, route tests, runtime tests, and web RuntimeAPI client auth methods.
- Extended Electron desktop host config to preserve `apiUrl` and `clientToken` fields for the upcoming packaged-UI instance model.
- Added Electron bundled UI protocol loading, packaged-mode API-only server startup, and runtime API config injection for main/mobile/mini-chat web entries.
- Added `electron:dev:bundled` to run bundled UI against the local API-only sidecar without Vite/HMR, including robust port selection for LAN bind mode.
- Fixed bundled UI bootstrap by injecting runtime config before app scripts and using the loopback sidecar URL as the API fallback.
- Added desktop-only CORS and WebSocket origin allowance for `openchamber-ui://app` so bundled UI can call the local API sidecar.
- Migrated shared UI runtime-critical direct `/api`/`/auth`/`/health` fetches to runtime-aware helpers across stores, core libs, Git, providers, MCP, GitHub, settings, TTS/STT, terminal, scheduled tasks, files/plan fallbacks, themes, behavior, onboarding, and desktop system/update paths.
- Added visible `incompatible` instance/recovery state handling for OpenChamber servers that fail version/capability checks.
- Added no-navigation Electron instance switching: runtime API/token mutation, SDK recreation, sync remount, config reset, and project-store reset so remote projects come from remote settings and empty remote project lists do not preserve stale local cache.
- Centralized Instance management in Settings. Header Instances dropdown now switches and links to Settings instead of doing inline add/edit/delete.
- Added Settings Direct Instances management with add, edit, delete, default selection, token storage, and import of `openchamber://connect?...` links.
- Added Client Tokens management and pairing/export UI in Settings: list/create/revoke tokens, one-time token display, connection link generation, and QR generation.
- Added runtime connection payload helpers for `openchamber://connect?v=1&server=...&token=...&label=...` and parser/import support for Electron.
- Added CLI `openchamber connect-url` with `--qr`, `--json`, `--quiet`, `--name`, and `--port` support to create a remote client token and connection link for an already-running web/API server.
- Moved VS Code-only file pick/save endpoints behind VS Code RuntimeAPI methods so shared UI no longer references direct `/api/vscode/*` paths.
- Added realtime remote-client auth propagation: runtime SSE/WebSocket URLs append `oc_client_token`, and server UI auth accepts the token from query for EventSource/WebSocket upgrade paths.
- Added authenticated asset URL support for token-protected packaged clients and migrated project icon URLs to use runtime-aware authenticated asset URLs.
- Redesigned Remote Instances Settings into a single page: hosted web shows connect-to-this-server token/link/QR management, while Desktop additionally exposes Direct Instances and SSH-managed instances with add/edit/import dialogs.
- Cleaned Remote Instances user-facing copy and localized affected strings in English, Ukrainian, Spanish, Portuguese, Polish, Korean, and Simplified Chinese.
- Added revoked remote client cleanup: server purge support, RuntimeAPI plumbing, Settings action, tests, and localized copy.
- Fixed bundled Electron new-window behavior for remote instances. New windows load local bundled UI with per-window runtime API URL/token instead of navigating to the remote web UI.
- Added legacy password-protected remote compatibility. Bundled Electron login uses the local bundled auth screen, then obtains or creates a remote client token through Electron main when browser cookies cannot be used cross-origin, persists the token back to the saved instance, and continues with bearer-token runtime auth.
- Added stable runtime identity for instance switching: `local`, `host:<id>`, `ssh:<id>`, with URL fallback only for ad-hoc targets.
- Added per-instance active session memory and bounded force rehydration so switching between instances restores the last selected session and materializes messages instead of getting stuck on skeleton loading.
- Updated public docs for `openchamber connect-url`, Desktop import flow, and the security distinction between UI password protection and remote client tokens.
- Patched `http-proxy@1.18.1` `util._extend` deprecation in both npm and Bun install layouts through `fix-deprecation.js` during `postinstall`.
- Latest local commit: `eb3c739e fix(electron): polish remote instance pairing flow`.
- Validation passed after these slices: targeted runtime/server tests, `bun run type-check`, and `bun run lint`.

## Validation Checklist

Run after each significant slice:

- `bun run type-check`
- `bun run lint`
- `bun run build`

Manual/runtime validation:

- Hosted web same-origin works.
- Hosted mobile `/mobile.html` works on iPhone/Safari.
- Electron loopback runtime works.
- VS Code runtime still uses bridge/proxy behavior.
- Raw file images and source previews work.
- SSE/session streaming works.
- WebSocket terminal or any realtime socket still connects where supported.
- Auth expiry/unreachable server states are visible, not silent failures.

Bundled Electron/API-split validation before PR:

- `bun run electron:dev:bundled` starts local packaged UI from `openchamber-ui://app` and local API-only sidecar.
- Local startup loads projects, sessions, providers, agents, settings, and git status from the sidecar.
- Sending a chat message works from bundled UI without HTML fallback/`Unexpected token '<'` API errors.
- Git changes/branches load in bundled UI against the active API base URL.
- Switching Local -> remote updates runtime API/token in-process without BrowserWindow navigation or full page reload.
- Switching remote -> Local updates runtime API/token in-process and reloads local projects/sessions/settings.
- Remote instance projects come from remote `settings.projects`; remote instances with zero projects show empty state rather than stale local projects.
- Sessions, live sync, message streaming, terminal/realtime connections, and abort/permission flows reconnect to the selected instance.
- Unreachable and incompatible instances block switching/main flow with visible errors.
- Manual token-protected remote instances work for initial data and realtime transports.
- Hosted web same-origin and VS Code runtime behavior remain unchanged after the Electron split.

## Mobile Plan Link

`local-dev-mobile-app-plan.md` tracks the mobile product/surface direction. This document owns the lower-level server/API decoupling work required before Capacitor mobile can become a true packaged remote client.
