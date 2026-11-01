using System.Text.Json;

namespace Games.Client.Services;

/// <summary>Loads and saves <see cref="GameSettings"/> under the <c>games.settings</c> key as <c>{ sound, speech }</c>.</summary>
public sealed class SettingsService
{
    public const string StorageKey = "games.settings";

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly ISettingsStore _store;
    private GameSettings? _current;

    public SettingsService(ISettingsStore store) => _store = store;

    public event Action? Changed;

    public async Task<GameSettings> GetAsync()
    {
        if (_current is not null) return _current;
        _current = new GameSettings();
        var raw = await _store.GetAsync(StorageKey);
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try { _current = JsonSerializer.Deserialize<GameSettings>(raw, JsonOptions) ?? _current; }
            catch (JsonException) { /* corrupt value: fall back to defaults */ }
        }
        return _current;
    }

    public async Task UpdateAsync(Func<GameSettings, GameSettings> change)
    {
        _current = change(await GetAsync());
        await _store.SetAsync(StorageKey, JsonSerializer.Serialize(_current, JsonOptions));
        Changed?.Invoke();
    }
}
