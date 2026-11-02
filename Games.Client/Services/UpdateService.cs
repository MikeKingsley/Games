using Microsoft.JSInterop;

namespace Games.Client.Services;

/// <summary>
/// Whether a newer version of the app is waiting to be activated, as reported by <c>js/update.js</c> (<c>window.gamesUpdate</c>).
/// <see cref="UpdateBanner"/> shows it; dismissing only hides it for this session and a further update shows it again.
/// </summary>
public sealed class UpdateService : IDisposable
{
    private readonly IJSRuntime _js;
    private DotNetObjectReference<UpdateService>? _self;

    public UpdateService(IJSRuntime js) => _js = js;

    public bool Visible { get; private set; }

    public event Action? Changed;

    /// <summary>Starts listening to the page; safe to call repeatedly.</summary>
    public async Task StartAsync()
    {
        if (_self is not null) return;
        _self = DotNetObjectReference.Create(this);
        try { await _js.InvokeVoidAsync("gamesUpdate.subscribe", _self); }
        catch (JSException) { /* no service worker support (e.g. dev server): there is simply never an update */ }
    }

    /// <summary>Called by <c>js/update.js</c> when a new version is waiting.</summary>
    [JSInvokable]
    public void OnUpdateAvailable()
    {
        if (Visible) return;
        Visible = true;
        Changed?.Invoke();
    }

    public void Dismiss()
    {
        if (!Visible) return;
        Visible = false;
        Changed?.Invoke();
    }

    /// <summary>Activates the waiting version and hides the banner; the page reloads itself once it has taken over.</summary>
    public async Task ApplyAsync()
    {
        Dismiss();
        if (!await _js.InvokeAsync<bool>("gamesUpdate.apply")) OnUpdateAvailable(); // nothing was waiting after all: keep offering it
    }

    public void Dispose() => _self?.Dispose();
}
