using Games.Client.Services;

namespace Games.Tests;

/// <summary>In-memory <see cref="ISettingsStore"/> standing in for browser localStorage.</summary>
internal sealed class MemoryStore : ISettingsStore
{
    public Dictionary<string, string> Data { get; } = [];

    public ValueTask<string?> GetAsync(string key) => ValueTask.FromResult(Data.GetValueOrDefault(key));

    public ValueTask SetAsync(string key, string value) { Data[key] = value; return ValueTask.CompletedTask; }

    public ValueTask RemoveAsync(string key) { Data.Remove(key); return ValueTask.CompletedTask; }
}
