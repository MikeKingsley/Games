using Games.Client.Services;

namespace Games.Tests;

public class SettingsServiceTests
{
    [Fact]
    public async Task Defaults_to_sound_and_speech_on_when_nothing_stored()
    {
        var settings = await new SettingsService(new MemoryStore()).GetAsync();
        Assert.True(settings.Sound);
        Assert.True(settings.Speech);
    }

    [Fact]
    public async Task Update_persists_camel_case_json_under_the_settings_key()
    {
        var store = new MemoryStore();
        var service = new SettingsService(store);

        await service.UpdateAsync(s => s with { Speech = false });

        Assert.Equal("""{"sound":true,"speech":false}""", store.Data[SettingsService.StorageKey]);
    }

    [Fact]
    public async Task Loads_previously_saved_values()
    {
        var store = new MemoryStore();
        store.Data[SettingsService.StorageKey] = """{"sound":false,"speech":true}""";

        var settings = await new SettingsService(store).GetAsync();

        Assert.False(settings.Sound);
        Assert.True(settings.Speech);
    }

    [Fact]
    public async Task Corrupt_stored_value_falls_back_to_defaults()
    {
        var store = new MemoryStore();
        store.Data[SettingsService.StorageKey] = "not json";

        Assert.Equal(new GameSettings(), await new SettingsService(store).GetAsync());
    }

    [Fact]
    public async Task Update_raises_Changed()
    {
        var service = new SettingsService(new MemoryStore());
        var raised = 0;
        service.Changed += () => raised++;

        await service.UpdateAsync(s => s with { Sound = false });

        Assert.Equal(1, raised);
    }
}
