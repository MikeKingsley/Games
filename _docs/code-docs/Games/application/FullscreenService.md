# FullscreenService
`Games.Client.Services` · [Services/FullscreenService.cs](../../../../Games.Client/Services/FullscreenService.cs) · generated 2026-11-02, commit: 2212302 (uncommitted changes)

Switches the Fullscreen setting from the Options page and the in-game grown-ups panel.

- Calls `kiosk.setFullscreen` (see `wwwroot/js/kiosk.js`) **before** saving, because browsers only allow fullscreen from inside the user's tap.
- Saves `Fullscreen` through `SettingsService`. `kiosk.js` reads the saved value itself at start-up (it loads before Blazor) to decide whether the first tap of a page load goes fullscreen.
- A `JSException` (no fullscreen support) is swallowed: the choice is still remembered.
- Depends on `IJSRuntime` and `SettingsService`.
