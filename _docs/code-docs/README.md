# Code docs

## Games (Games.Client)
### application
- [GameInfo](Games/application/GameInfo.md) — registry entry record
- [GameFeatures](Games/application/GameFeatures.md) — per-game opt-outs for shell features (Hardcore, levels)
- [GameRegistry](Games/application/GameRegistry.md) — loads games/registry.json
- [GameSettings](Games/application/GameSettings.md) — sound/speech/show-foods switches
- [PauseState](Games/application/PauseState.md) — "menu open, hold the game still" flag
- [UpdateService](Games/application/UpdateService.md) — "new version waiting" flag for the update banner
- [FullscreenService](Games/application/FullscreenService.md) — fullscreen switch (browser call, then save)
- [ISettingsStore](Games/application/ISettingsStore.md) — key/value storage abstraction
- [ProgressService](Games/application/ProgressService.md) — reads/clears a game's saved level
- [SettingsService](Games/application/SettingsService.md) — persisted settings with change event
### infrastructure
- [LocalStorageSettingsStore](Games/infrastructure/LocalStorageSettingsStore.md) — localStorage via JS interop

Not documented: Razor components (GameHost, CornerButton, UpdateBanner, ParentCorner, pages) — not classes in scope.
