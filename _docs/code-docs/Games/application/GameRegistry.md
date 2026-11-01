# GameRegistry
`Games.Client.Services` · [Services/GameRegistry.cs](../../../../Games.Client/Services/GameRegistry.cs) · generated 2026-11-01, commit: none yet (uncommitted)

Loads the list of playable games from `games/registry.json` over HTTP and caches it for the session. This is how new games are added without touching C#.

- `GetAllAsync` / `FindAsync(id)` (case-insensitive id match).
- `Parse(json)` is static so tests can read the JSON without HTTP.

Dependency: `HttpClient` (base address = app root).
