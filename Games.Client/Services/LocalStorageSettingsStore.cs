using Microsoft.JSInterop;

namespace Games.Client.Services;

/// <summary>Browser localStorage implementation of <see cref="ISettingsStore"/>.</summary>
public sealed class LocalStorageSettingsStore : ISettingsStore
{
    private readonly IJSRuntime _js;

    public LocalStorageSettingsStore(IJSRuntime js) => _js = js;

    public ValueTask<string?> GetAsync(string key) => _js.InvokeAsync<string?>("localStorage.getItem", key);

    public ValueTask SetAsync(string key, string value) => _js.InvokeVoidAsync("localStorage.setItem", key, value);

    public ValueTask RemoveAsync(string key) => _js.InvokeVoidAsync("localStorage.removeItem", key);
}
