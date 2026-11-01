# ProgressService
`Games.Client.Services` · [Services/ProgressService.cs](../../../../Games.Client/Services/ProgressService.cs) · generated 2026-11-01, commit: none yet (uncommitted)

Reads and clears a game's saved progress, which the game's own JavaScript writes to localStorage as `games.progress.{id}` (`{ "rounds": n, "stars": n }`). Used by the Options page to show "Level N" and to reset a game.

- `GetLevelAsync(id)`: rounds completed + 1; level 1 when nothing is saved or the value is unreadable (bad JSON, non-object, missing/non-numeric/negative `rounds`).
- `ResetAsync(id)`: removes only that game's key, so settings and other games are untouched.
- Dependency: `ISettingsStore`.
