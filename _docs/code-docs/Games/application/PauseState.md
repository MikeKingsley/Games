# PauseState
`Games.Client.Services` · [Services/PauseState.cs](../../../../Games.Client/Services/PauseState.cs) · generated 2026-11-01, commit: none yet (uncommitted)

Scoped flag saying "hold the game still": `ParentCorner` sets it while the grown-ups panel is open (and clears it on close or when the page is left); `GameHost` listens to `Changed` and relays it to the game as `setOptions({ paused })`. Animal feeding uses it to freeze its countdown.

- `Set` raises `Changed` only when the value actually changes.
- Only the countdown stops; the rest of the game is covered by the open panel anyway.
