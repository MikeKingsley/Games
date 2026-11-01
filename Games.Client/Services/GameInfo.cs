namespace Games.Client.Services;

/// <summary>One entry in <c>games/registry.json</c>: a playable game and where its JS module lives.</summary>
public sealed record GameInfo(string Id, string Title, string Icon, string Module);
