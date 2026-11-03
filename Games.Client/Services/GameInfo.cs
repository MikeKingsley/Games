namespace Games.Client.Services;

/// <summary>One entry in <c>games/registry.json</c>: a playable game and where its JS module lives.</summary>
public sealed record GameInfo(string Id, string Title, string Icon, string Module, GameFeatures? Features = null)
{
    /// <summary>Whether the grown-ups panel offers Hardcore Mode for this game.</summary>
    public bool HasHardcore => Features?.Hardcore ?? true;

    /// <summary>Whether the Options page shows this game's "Level N / Reset levels" row.</summary>
    public bool HasLevels => Features?.Levels ?? true;
}

/// <summary>Shell features a game can opt out of (games with their own save system don't use the shell's levels).</summary>
public sealed record GameFeatures(bool Hardcore = true, bool Levels = true);
