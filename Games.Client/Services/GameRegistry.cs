using System.Net.Http.Json;
using System.Text.Json;

namespace Games.Client.Services;

/// <summary>Reads the list of available games from <c>games/registry.json</c>.</summary>
public sealed class GameRegistry
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly HttpClient _http;
    private IReadOnlyList<GameInfo>? _games;

    public GameRegistry(HttpClient http) => _http = http;

    public static IReadOnlyList<GameInfo> Parse(string json) =>
        JsonSerializer.Deserialize<List<GameInfo>>(json, JsonOptions) ?? [];

    public async Task<IReadOnlyList<GameInfo>> GetAllAsync()
    {
        _games ??= await _http.GetFromJsonAsync<List<GameInfo>>("games/registry.json", JsonOptions) ?? [];
        return _games;
    }

    public async Task<GameInfo?> FindAsync(string id) =>
        (await GetAllAsync()).FirstOrDefault(g => string.Equals(g.Id, id, StringComparison.OrdinalIgnoreCase));
}
