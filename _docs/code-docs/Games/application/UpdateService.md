# UpdateService
`Games.Client.Services` · [Services/UpdateService.cs](../../../../Games.Client/Services/UpdateService.cs) · generated 2026-11-01, commit: 2212302 (uncommitted changes)

Scoped flag saying "a newer version of the app is waiting". `js/update.js` (`window.gamesUpdate`) calls `OnUpdateAvailable` through a `DotNetObjectReference`; `UpdateBanner` shows the banner while `Visible` is true and calls `ApplyAsync` after the tap-to-update gesture.

- `StartAsync` subscribes once (idempotent); a missing `gamesUpdate` (no service worker, e.g. the dev server) is swallowed, so there is simply never an update.
- `Dismiss` hides the banner (called by `ApplyAsync`; the banner has no close button); a further `OnUpdateAvailable` shows it again. Nothing is persisted.
- `ApplyAsync` hides the banner and asks the waiting worker to take over; the page reloads itself once it has.
- `Changed` fires only when `Visible` actually changes.
- Depends on `IJSRuntime`. Implements `IDisposable` to release the .NET reference.
