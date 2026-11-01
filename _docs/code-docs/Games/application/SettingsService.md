# SettingsService
`Games.Client.Services` · [Services/SettingsService.cs](../../../../Games.Client/Services/SettingsService.cs) · generated 2026-11-01, commit: none yet (uncommitted)

Loads and saves `GameSettings` as camelCase JSON (`{"sound":true,"speech":false}`) under localStorage key `games.settings`. Caches the value and raises `Changed` after each update so a running game can be told immediately.

- Missing or corrupt stored JSON silently falls back to defaults.
- Dependency: `ISettingsStore`.
