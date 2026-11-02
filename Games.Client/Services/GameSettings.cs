namespace Games.Client.Services;

/// <summary>Parent-controlled switches shared by every game. <c>Fullscreen</c> (off by default) makes the app go fullscreen on the first tap of each page load.</summary>
public sealed record GameSettings(bool Sound = true, bool Speech = true, bool Fullscreen = false);
