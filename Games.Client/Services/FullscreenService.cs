using Microsoft.JSInterop;

namespace Games.Client.Services;

/// <summary>
/// Switches the Fullscreen setting. The browser only allows fullscreen from inside a user gesture, so the JavaScript
/// call (<c>kiosk.setFullscreen</c>) goes first, before the setting is saved.
/// </summary>
public sealed class FullscreenService
{
    private readonly IJSRuntime _js;
    private readonly SettingsService _settings;

    public FullscreenService(IJSRuntime js, SettingsService settings)
    {
        _js = js;
        _settings = settings;
    }

    public async Task SetAsync(bool on)
    {
        try { await _js.InvokeVoidAsync("kiosk.setFullscreen", on); }
        catch (JSException) { /* no fullscreen support here: still remember the choice */ }
        await _settings.UpdateAsync(s => s with { Fullscreen = on });
    }
}
