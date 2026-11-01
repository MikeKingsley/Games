namespace Games.Client.Services;

/// <summary>Raw key/value persistence so <see cref="SettingsService"/> can be tested without a browser.</summary>
public interface ISettingsStore
{
    ValueTask<string?> GetAsync(string key);
    ValueTask SetAsync(string key, string value);
    ValueTask RemoveAsync(string key);
}
