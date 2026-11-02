# Fresher App After Deploy (auto-apply updates on Home)

Stop people seeing stale CSS/JS after a deploy: when a new version is waiting and the child is on Home or Options (not mid-game), apply it automatically; keep the tap-to-update banner while a game is running; check for updates more eagerly.

## Decisions & Answers

- **Q (user, 2026-11-02):** The award-stars problem — **A:** "nevermind it was a cached stylesheet." The award CSS change and its test were reverted; the cause was the stale cache, which motivates this plan.
- **Q:** "can you make the app cache better" — what do you want better? — **A:** Fresher after deploy (not dev-server staleness, not offline reliability).
- **Q:** How should a new deploy reach people? — **A:** Auto-apply on Home screen: when an update is waiting and the child is on Home/Options (not mid-game), reload into the new version automatically; the banner still shows during a game; also check for updates more often (on every navigation to Home). This supersedes plan 0003's "tap Update only" for the Home/Options screens.

Assumptions (not asked; defaults chosen): auto-apply at most once per 60 s (guard stored in `sessionStorage`) so a worker that never takes over cannot cause a reload loop; Options counts as idle; the Play page and anything mid-game is not idle; periodic check stays at 30 min plus checks on Home navigation and `visibilitychange`; no change to the service worker caching strategy (cache-first with manifest hashes stays, since mixing network-fresh files with hashed Blazor files would break integrity checks); no change to the GitHub Pages workflow.

## For Future Agents
As work proceeds: mark the item you are actively working on `- 🔄` (at most one per
phase) and flip it to `- ✅` when it completes; when a phase is done,
set its status to `Complete` and write its **Phase Summary** (what was done, key
decisions, anything needed to continue with zero context); run the phase's
**Verification Plan** and record the result before moving on. When all phases are
done, fill in **Final Recap** and **Deployment Plan**.

Key facts: update logic is `Games.Client/wwwroot/js/update.js` (`createUpdater`, `install`, `window.gamesUpdate = { subscribe, apply }`), .NET side `Games.Client/Services/UpdateService.cs` and `Components/UpdateBanner.razor` (mounted in `Layout/MainLayout.razor`). Home is `Pages/Home.razor`, Options `Pages/Options.razor`, game `Pages/Play.razor`. JS tests: `npm test` (`tests/js/update.test.mjs`); e2e: `npm run test:e2e` (`tests/e2e/update-banner.spec.mjs` fakes a service worker). C# tests: `dotnet test Games.slnx` (`tests/Games.Tests`). Run Playwright muted (`--mute-audio` is in `playwright.config.mjs`).

## Phase 1: Update check on demand (JS)
Status: Not started

- [ ] In `update.js` add `check()` to the updater (calls `registration.update()` ignoring failures, no-op before registration) and expose it as `window.gamesUpdate.check()`.
- [ ] Add a once-per-60 s auto-apply guard in `applyUpdate` callers: `applyUpdate({ auto: true })` returns false (and does nothing) if a `sessionStorage` timestamp `games.autoUpdate` is under 60 s old, otherwise stores now and proceeds. Inject `storage` into `createUpdater` for testability.
- [ ] Expose `window.gamesUpdate.apply(auto)` passing the flag through.

### Verification Plan
- `npm test` passes with new cases in `tests/js/update.test.mjs`: `check()` calls `registration.update()` and swallows rejection; `applyUpdate({ auto: true })` applies once, then returns false within 60 s and applies again after 60 s; manual `applyUpdate()` ignores the guard.

### Phase Summary
_(write when phase completes)_

## Phase 2: Idle auto-apply (.NET)
Status: Not started

- [ ] `UpdateService`: add `SetIdle(bool)` (true while on Home/Options); when idle and an update is waiting (now or arriving later), call `gamesUpdate.apply(true)` automatically and hide the banner only if it returned true; add `CheckAsync()` calling `gamesUpdate.check()` (swallow `JSException`).
- [ ] `Home.razor` and `Options.razor`: on init call `Updates.SetIdle(true)` and `Updates.CheckAsync()`; implement `IDisposable` to call `SetIdle(false)`.
- [ ] Add unit tests in `tests/Games.Tests/UpdateServiceTests.cs` (fake `IJSRuntime`): update while idle auto-applies; update while not idle only shows the banner; becoming idle with an update waiting auto-applies; auto-apply refused (returns false) keeps the banner visible.
- [ ] Add e2e in `tests/e2e/update-banner.spec.mjs`: with the fake waiting worker, Home auto-sends `SKIP_WAITING` without a tap; the same update opened on `/play/animal-feeding` shows the banner and sends nothing until tapped.
- [ ] Update README/deploy note: updates now apply automatically on the Home screen; tap Update during a game.

### Verification Plan
- `dotnet test Games.slnx` passes including the new `UpdateServiceTests`.
- `npm test` passes; `npm run test:e2e` passes (muted), including the two new update-banner cases.

### Phase Summary
_(write when phase completes)_

## Final Recap
_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan
_(write when all phases complete: step-by-step deployment instructions)_
