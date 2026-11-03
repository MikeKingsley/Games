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
    public void Features_default_to_on_when_missing()
    {
        var game = Assert.Single(GameRegistry.Parse("""[{ "id": "a", "title": "A", "icon": "🐵", "module": "m.js" }]"""));

        Assert.True(game.HasHardcore);
        Assert.True(game.HasLevels);
    }

    [Fact]
    public void Features_missing_from_the_features_object_default_to_on()
    {
        var game = Assert.Single(GameRegistry.Parse("""[{ "id": "a", "title": "A", "icon": "🐵", "module": "m.js", "features": { "levels": false } }]"""));

        Assert.True(game.HasHardcore);
        Assert.False(game.HasLevels);
    }

    [Fact]
    public void Features_can_be_switched_off()
    {
        var game = Assert.Single(GameRegistry.Parse("""[{ "id": "a", "title": "A", "icon": "🐵", "module": "m.js", "features": { "hardcore": false, "levels": false } }]"""));

        Assert.False(game.HasHardcore);
        Assert.False(game.HasLevels);
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
