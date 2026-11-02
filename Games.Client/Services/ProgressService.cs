using System.Text.Json;

namespace Games.Client.Services;

/// <summary>Reads and clears a game's saved progress (<c>games.progress.{id}</c>, written by the game's own JavaScript).</summary>
public sealed class ProgressService
{
    private readonly ISettingsStore _store;

    public ProgressService(ISettingsStore store) => _store = store;

    public static string KeyFor(string gameId) => $"games.progress.{gameId}";

    /// <summary>The level the player is on: rounds completed + 1. A game with no saved progress is on level 1.</summary>
    public async Task<int> GetLevelAsync(string gameId)
    {
        var raw = await _store.GetAsync(KeyFor(gameId));
        if (string.IsNullOrWhiteSpace(raw)) return 1;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("rounds", out var rounds)
                && rounds.ValueKind == JsonValueKind.Number
                && rounds.TryGetInt32(out var n) && n >= 0
                ? n + 1 : 1;
        }
        catch (JsonException) { return 1; }
    }

    /// <summary>Whether the game is in Hardcore Mode (<c>"hardcore": true</c> in its saved progress). It stays on until <see cref="ResetAsync"/>.</summary>
    public async Task<bool> IsHardcoreAsync(string gameId)
    {
        var raw = await _store.GetAsync(KeyFor(gameId));
        if (string.IsNullOrWhiteSpace(raw)) return false;
        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("hardcore", out var flag)
                && flag.ValueKind == JsonValueKind.True;
        }
        catch (JsonException) { return false; }
    }

    /// <summary>Raised when a grown-up asks to switch the game into Hardcore Mode; the running game does the switching and saves the flag itself.</summary>
    public event Action<string>? HardcoreRequested;

    public void RequestHardcore(string gameId) => HardcoreRequested?.Invoke(gameId);

    /// <summary>Forgets all saved progress (including Hardcore Mode) for the game, so it starts again at level 1 with Hardcore Mode off.</summary>
    public async Task ResetAsync(string gameId) => await _store.RemoveAsync(KeyFor(gameId));
}
