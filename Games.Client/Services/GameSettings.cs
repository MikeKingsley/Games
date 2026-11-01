namespace Games.Client.Services;

/// <summary>Parent-controlled switches shared by every game.</summary>
public sealed record GameSettings(bool Sound = true, bool Speech = true);
