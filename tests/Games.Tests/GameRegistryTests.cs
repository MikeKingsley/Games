using Games.Client.Services;

namespace Games.Tests;

public class GameRegistryTests
{
    [Fact]
    public void Parse_reads_games_case_insensitively()
    {
        var games = GameRegistry.Parse("""[{ "id": "a", "Title": "A game", "icon": "🐵", "module": "games/a/index.js" }]""");

        var game = Assert.Single(games);
        Assert.Equal(new GameInfo("a", "A game", "🐵", "games/a/index.js"), game);
    }

    [Fact]
    public void Shipped_registry_lists_the_animal_feeding_game_and_every_module_file_exists()
    {
        var root = AppContext.BaseDirectory;
        while (root is not null && !File.Exists(Path.Combine(root, "Games.slnx"))) root = Path.GetDirectoryName(root);
        Assert.NotNull(root);

        var wwwroot = Path.Combine(root, "Games.Client", "wwwroot");
        var games = GameRegistry.Parse(File.ReadAllText(Path.Combine(wwwroot, "games", "registry.json")));

        Assert.All(games, g => Assert.True(File.Exists(Path.Combine(wwwroot, g.Module)), g.Module));
        Assert.Contains(games, g => g.Id == "animal-feeding");
    }
}
