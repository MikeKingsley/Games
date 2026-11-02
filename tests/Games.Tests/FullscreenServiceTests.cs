using Games.Client.Services;
using Microsoft.JSInterop;

namespace Games.Tests;

public class FullscreenServiceTests
{
    private sealed class FakeJs : IJSRuntime
    {
        public List<(string Identifier, object?[] Args)> Calls { get; } = [];

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, object?[]? args)
        {
            Calls.Add((identifier, args ?? []));
            return ValueTask.FromResult(default(TValue)!);
        }

        public ValueTask<TValue> InvokeAsync<TValue>(string identifier, CancellationToken cancellationToken, object?[]? args) => InvokeAsync<TValue>(identifier, args);
    }

    [Fact]
    public async Task Turning_it_on_calls_the_browser_first_then_saves_the_setting()
    {
        var store = new MemoryStore();
        var js = new FakeJs();
        var settings = new SettingsService(store);

        await new FullscreenService(js, settings).SetAsync(true);

        Assert.Equal("kiosk.setFullscreen", Assert.Single(js.Calls).Identifier);
        Assert.Equal(true, js.Calls[0].Args[0]);
        Assert.True((await settings.GetAsync()).Fullscreen);
        Assert.Contains("\"fullscreen\":true", store.Data[SettingsService.StorageKey]);
    }

    [Fact]
    public async Task Turning_it_off_leaves_sound_and_speech_alone()
    {
        var settings = new SettingsService(new MemoryStore());
        var service = new FullscreenService(new FakeJs(), settings);
        await settings.UpdateAsync(s => s with { Sound = false });
        await service.SetAsync(true);

        await service.SetAsync(false);

        Assert.Equal(new GameSettings(Sound: false), await settings.GetAsync());
    }
}
