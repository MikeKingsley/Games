# GameFeatures
`Games.Client.Services` · [Services/GameInfo.cs](../../../../Games.Client/Services/GameInfo.cs) · generated 2026-11-02, commit 29b0d99 (+ uncommitted changes)

Record for the optional `features` object of a registry entry: `Hardcore` and `Levels`, both default `true`. It exists so a game with its own save and difficulty rules (Delivery Driver) can opt out of the shell's Hardcore Mode and level reset UI.

- Defaults come from the constructor's default parameter values, which System.Text.Json uses when a field is missing.
