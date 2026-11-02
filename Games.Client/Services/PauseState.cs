namespace Games.Client.Services;

/// <summary>
/// Whether the running game should be held still because a grown-ups menu is open on top of it.
/// <see cref="ParentCorner"/> sets it; <see cref="GameHost"/> relays it to the game as the <c>paused</c> option.
/// </summary>
public sealed class PauseState
{
    public bool Paused { get; private set; }

    public event Action? Changed;

    public void Set(bool paused)
    {
        if (paused == Paused) return;
        Paused = paused;
        Changed?.Invoke();
    }
}
