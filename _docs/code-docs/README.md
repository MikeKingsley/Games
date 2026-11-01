# Code docs

## Games (Games.Client)
### application
- [GameInfo](Games/application/GameInfo.md) — registry entry record
- [GameRegistry](Games/application/GameRegistry.md) — loads games/registry.json
- [GameSettings](Games/application/GameSettings.md) — sound/speech switches
- [ISettingsStore](Games/application/ISettingsStore.md) — key/value storage abstraction
- [ProgressService](Games/application/ProgressService.md) — reads/clears a game's saved level
- [SettingsService](Games/application/SettingsService.md) — persisted settings with change event
### infrastructure
- [LocalStorageSettingsStore](Games/infrastructure/LocalStorageSettingsStore.md) — localStorage via JS interop

Not documented: Razor components (GameHost, HoldToOpen, ParentCorner, pages) — not classes in scope.
