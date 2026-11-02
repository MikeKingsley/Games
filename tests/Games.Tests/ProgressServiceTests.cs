using Games.Client.Services;

namespace Games.Tests;

public class ProgressServiceTests
{
    [Fact]
    public async Task No_saved_progress_is_level_1()
    {
        Assert.Equal(1, await new ProgressService(new MemoryStore()).GetLevelAsync("animal-feeding"));
    }

    [Fact]
    public async Task Level_is_rounds_completed_plus_one()
    {
        var store = new MemoryStore();
        store.Data["games.progress.animal-feeding"] = """{"rounds":15,"stars":5}""";

        Assert.Equal(16, await new ProgressService(store).GetLevelAsync("animal-feeding"));
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("""{"stars":2}""")]
    [InlineData("""{"rounds":-4}""")]
    [InlineData("""{"rounds":"many"}""")]
    [InlineData("5")]
    public async Task Unreadable_progress_falls_back_to_level_1(string raw)
    {
        var store = new MemoryStore();
        store.Data["games.progress.animal-feeding"] = raw;

        Assert.Equal(1, await new ProgressService(store).GetLevelAsync("animal-feeding"));
    }

    [Fact]
    public async Task Reset_removes_only_that_games_progress()
    {
        var store = new MemoryStore();
        store.Data["games.progress.animal-feeding"] = """{"rounds":40}""";
        store.Data["games.progress.other"] = """{"rounds":3}""";
        store.Data[SettingsService.StorageKey] = """{"sound":false,"speech":true}""";
        var service = new ProgressService(store);

        await service.ResetAsync("animal-feeding");

        Assert.Equal(1, await service.GetLevelAsync("animal-feeding"));
        Assert.Equal(4, await service.GetLevelAsync("other"));
        Assert.True(store.Data.ContainsKey(SettingsService.StorageKey));
    }

    [Theory]
    [InlineData("""{"rounds":3,"stars":1,"hardcore":true}""", true)]
    [InlineData("""{"rounds":3,"hardcore":false}""", false)]
    [InlineData("""{"rounds":3}""", false)]
    [InlineData("""{"hardcore":"yes"}""", false)]
    [InlineData("not json", false)]
    public async Task Hardcore_is_read_from_saved_progress(string raw, bool expected)
    {
        var store = new MemoryStore();
        store.Data["games.progress.animal-feeding"] = raw;

        Assert.Equal(expected, await new ProgressService(store).IsHardcoreAsync("animal-feeding"));
    }

    [Fact]
    public async Task No_saved_progress_is_not_hardcore_and_reset_turns_it_off()
    {
        var store = new MemoryStore();
        var progress = new ProgressService(store);
        Assert.False(await progress.IsHardcoreAsync("animal-feeding"));

        store.Data["games.progress.animal-feeding"] = """{"rounds":3,"hardcore":true}""";
        await progress.ResetAsync("animal-feeding");

        Assert.False(await progress.IsHardcoreAsync("animal-feeding"));
    }

    [Fact]
    public void RequestHardcore_tells_listeners_which_game()
    {
        var progress = new ProgressService(new MemoryStore());
        string? seen = null;
        progress.HardcoreRequested += id => seen = id;

        progress.RequestHardcore("animal-feeding");

        Assert.Equal("animal-feeding", seen);
    }
}
