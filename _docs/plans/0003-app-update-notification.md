# App Update Notification

Tell people with the app open (or installed as a PWA) that a new version has been deployed, and let a grown-up apply it with a hold-gated "Update" button. Today the published service worker (`service-worker.published.js`) has no `skipWaiting`, so a new version only takes over after every tab/app window is closed.

## Decisions & Answers

- **Q:** How should the update notice behave when a new version is ready? — **A:** Banner with Reload button (non-blocking banner with an Update button that activates the new service worker and reloads, plus a dismiss option).
- **Q:** Where in the UI should the notice appear, and who sees it? — **A:** Global banner, behind the existing HoldToOpen gate (shown on every screen; the Update button uses the same hold-to-confirm pattern so kids can't trigger it accidentally).
- **Q:** How should the app detect a new version? — **A:** Service worker update (browser SW `updatefound` / waiting lifecycle, driven by the assets-manifest hash that changes every publish, plus periodic `registration.update()` checks). No version.json.
- **Q:** Show while a child is mid-game? — **A:** Show anywhere, small and non-blocking (corner pill, hold-to-update, ignorable).
- **Q:** What happens on dismiss? — **A:** Per-session only, nothing persisted; reappears on next app launch or next detected update. The new version also installs naturally once all tabs/windows are closed.
- **Q:** Include tests and docs? — **A:** Yes: JS unit test + Playwright e2e + README/deploy note (replace the "close and reopen the app" note).

Assumptions (not asked; defaults chosen): check for updates on page load, on `visibilitychange` to visible, and every 30 minutes; reload exactly once after the new worker takes control (`controllerchange`); no banner in dev (dev `service-worker.js` is a no-op); no change to the GitHub Pages workflow.

- **Q (follow-up, 2026-11-01):** Hold-to-update is annoying — **A:** Removed; Update is now a plain tap on a "🔄 Update" button (supersedes the hold-gate decision above). The banner hides as soon as Update is pressed, and if the browser never reports the worker switch within 3 s the worker + offline caches are cleared before reloading.

- **Q (follow-up, 2026-11-01):** Remove the close button from the banner — **A:** Done; the banner only has the 🔄 Update button (supersedes the per-session dismiss decision; `UpdateService.Dismiss` remains internal, used when Update is pressed).

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per
phase) and flip it to `- ✅` when it completes; when a phase is done,
set its status to `Complete` and write its **Phase Summary** (what was done, key
decisions, anything needed to continue with zero context); run the phase's
**Verification Plan** and record the result before moving on. When all phases are
done, fill in **Final Recap** and **Deployment Plan**.

Key facts: Blazor WASM (net10.0) in `Games.Client/`. Service worker registered in `Games.Client/wwwroot/index.html` (`updateViaCache: "none"`). The published worker (`wwwroot/service-worker.published.js`) caches `offline-cache-<assetsManifest.version>`; the dev worker is a no-op. Existing hold gate: `Games.Client/Components/HoldToOpen.razor` (`HoldMs = 500`, `OnHeld` callback). JS tests: `npm test` (`tests/js/*.test.mjs`); e2e: `npm run test:e2e` (`tests/e2e/`). Follow the style of existing `wwwroot/js/kiosk.js` / `host.js`.

## Phase 1: Update detection and activation (JS + service worker)
Status: Complete

- ✅ Add a `message` listener to `service-worker.published.js`: on `{ type: 'SKIP_WAITING' }` call `self.skipWaiting()` (do NOT call it unconditionally on install, so updates never swap under a running game without consent).
- ✅ Create `wwwroot/js/update.js`: pure/testable logic that wraps a `ServiceWorkerRegistration` — detects a waiting worker (already waiting at load, or via `updatefound` → `statechange === 'installed'` while `navigator.serviceWorker.controller` exists), exposes `onUpdateAvailable(cb)`, `applyUpdate()` (postMessage `SKIP_WAITING` to the waiting worker; reload once on `controllerchange`), and `startChecks(registration)` (update on load, `visibilitychange`→visible, every 30 min).
- ✅ Wire it up in `index.html` (load `js/update.js`, call it after `register(...)`), ignoring the first-install case (no existing controller = nothing to "update").
- ✅ Expose a JS-interop surface for Blazor: `window.gamesUpdate = { subscribe(dotNetRef), apply() }` that invokes `OnUpdateAvailable` on the .NET ref (and immediately if an update is already waiting).
  - Done inside `install()` in `update.js` (no separate file). Unit test `tests/js/update.test.mjs` is written as part of Phase 1 verification.

### Verification Plan
- `npm test` passes, including new `tests/js/update.test.mjs` covering: waiting-at-load triggers callback; `updatefound`→installed triggers callback only when a controller exists; first install does not trigger; `applyUpdate` posts `SKIP_WAITING` and reloads once on `controllerchange` (mock registration/navigator/location).
- `grep -n SKIP_WAITING Games.Client/wwwroot/service-worker.published.js` shows the message handler and no unconditional `skipWaiting()` in `onInstall`.

### Phase Summary
Complete (2026-11-01). `service-worker.published.js` now handles a `SKIP_WAITING` message (no unconditional skipWaiting). New ES module `wwwroot/js/update.js` exports `createUpdater` (injectable: detects waiting/updated workers only when a controller exists, `onUpdateAvailable`, `applyUpdate` with a single reload on `controllerchange`, checks on load/visibility/30 min) and `install()`, which registers the worker and exposes `window.gamesUpdate = { subscribe(dotNetRef), apply() }`; `subscribe` calls `dotNetRef.invokeMethodAsync('OnUpdateAvailable')`. `index.html` now loads it via `<script type="module">` instead of the inline register call. Verification: `npm test` 44/44 pass (7 new in `tests/js/update.test.mjs`); grep confirms the handler. No C# touched, so no code docs refresh.

## Phase 2: Banner UI (Blazor)
Status: Complete

- ✅ Add `Games.Client/Services/UpdateService.cs`: registers a `[JSInvokable] OnUpdateAvailable`, holds `UpdateAvailable` bool + `Changed` event, `Dismiss()` (session-only flag, re-shown if a further update arrives), `ApplyAsync()` calling `gamesUpdate.apply`. Register in `Program.cs` as a singleton and initialise at startup.
- ✅ Add `Games.Client/Components/UpdateBanner.razor` (+ scoped CSS): small top-corner pill "New version ready" with an Update button built on the `HoldToOpen` hold pattern (reuse/parameterise `HoldToOpen` rather than duplicating timing logic; keep its existing gear usage unchanged) and a dismiss (✕) button. Non-blocking, `aria-live="polite"`, respects safe-area insets and does not cover the existing gear corner button.
- ✅ Render `<UpdateBanner />` once globally in `Layout/MainLayout.razor`.
- ✅ Add a .NET unit test in `tests/Games.Tests` for `UpdateService` state transitions (available → dismissed → available again on a new update).

### Verification Plan
- `dotnet build Games.slnx` succeeds with no warnings introduced.
- `dotnet test Games.slnx` passes, including new `UpdateService` tests.

### Phase Summary
Complete (2026-11-01). Added `Services/UpdateService.cs` (scoped; `Visible`, `Changed`, `[JSInvokable] OnUpdateAvailable`, `Dismiss`, `ApplyAsync`, `StartAsync`; registered in `Program.cs`), `Components/UpdateBanner.razor` + `.razor.css` (fixed top-right pill, `data-testid="update-banner"`, `aria-live=polite`, ✕ dismiss), rendered in `MainLayout.razor`. `HoldToOpen` gained `Icon` and `Label` parameters (defaults keep the gear unchanged) and is reused for the hold-to-update button. `UpdateBanner` starts the service in `OnInitializedAsync`. Test: `tests/Games.Tests/UpdateServiceTests.cs`. Verification: `dotnet build Games.slnx` 0 warnings/0 errors; `dotnet test` 18/18 pass. Code docs refreshed: `_docs/code-docs/Games/application/UpdateService.md` + README index (Razor components are not documented by convention).

## Phase 3: End-to-end test and docs
Status: Complete

- ✅ Add a Playwright spec `tests/e2e/update-banner.spec.mjs`: load the app, simulate an update by calling the `gamesUpdate` callback hook (or stubbing a waiting registration via `page.addInitScript`), assert the banner appears, a plain tap on Update does nothing, a 500 ms+ hold triggers apply (assert `SKIP_WAITING` posted / reload requested), and dismiss hides it.
- ✅ Update `README.md` and the deploy/update-cycle note in `_docs/plans/0001-games-app-animal-feeding.md` (item 7 "users get the new version after closing and reopening") to describe the banner flow.
- ✅ Manual-equivalent check documented in README: publish locally twice with a changed asset and confirm the banner appears in the first tab.

### Verification Plan
- `npm run test:e2e` passes including the new spec.
- `npm test` and `dotnet test Games.slnx` still pass.
- `grep -n "closing and reopening" README.md _docs/plans/0001-games-app-animal-feeding.md` returns nothing.

### Phase Summary
Complete (2026-11-01). `tests/e2e/update-banner.spec.mjs` (3 tests) fakes `navigator.serviceWorker` with a waiting worker via `addInitScript`: banner appears, a tap does nothing, a ~800 ms hold posts `SKIP_WAITING`, dismiss hides it, and no banner without an update. README gained an "Updates" section (incl. local reproduction steps); plan 0001's update-cycle note rewritten. Verification: `npm run test:e2e` 9/9, `npm test` 44/44, `dotnet test` 18/18; no "closing and reopening" text remains. The real worker handoff (`SKIP_WAITING` -> `controllerchange` -> reload) is only covered by unit tests with mocks, not by a real two-publish browser run.

## Final Recap
Open and installed copies of the app now learn about new deployments. `js/update.js` detects a waiting service worker (load, foreground, every 30 min), `UpdateService` + `UpdateBanner` show a non-blocking "New version ready" pill, and the update is applied only after a grown-up holds the 🔄 button (`SKIP_WAITING` -> reload once). Dismiss is per-session. Covered by 7 JS unit tests, 1 .NET test and 3 Playwright tests; README and code docs updated.

## Deployment Plan
1. Merge to `main`; the `pages.yml` workflow tests, patches the base path, publishes and deploys (no workflow changes needed).
2. The first deploy containing this change cannot notify anyone: running copies still have the old worker without the message handler. They pick it up the normal way (all windows closed, reopened). Every deploy after that shows the banner.
3. After the second deploy, open the installed app on a device that has the first version, switch away and back, and confirm the pill appears; hold the 🔄 button and confirm the app reloads into the new version.
