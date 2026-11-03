# GameInfo
`Games.Client.Services` · [Services/GameInfo.cs](../../../../Games.Client/Services/GameInfo.cs) · generated 2026-11-02, commit 29b0d99 (+ uncommitted changes)

Record for one entry in `games/registry.json`: `Id`, `Title`, `Icon` (emoji), `Module` (path to the game's JS module), and optional `Features`. Used for home tiles, to mount a game, and to decide which shell features apply to it.

- `HasHardcore` / `HasLevels` read `Features`, defaulting to `true` when `features` (or one of its fields) is missing from the JSON.
- `ParentCorner.razor` hides the Hardcore Mode button when `HasHardcore` is false; `Options.razor` hides the game's "Level N / Reset levels" row when `HasLevels` is false.
