using Games.Client.Services;

namespace Games.Tests;

public class PauseStateTests
{
    [Fact]
    public void Starts_unpaused_and_raises_Changed_only_when_the_value_changes()
    {
        var state = new PauseState();
        var raised = 0;
        state.Changed += () => raised++;

        Assert.False(state.Paused);
        state.Set(false);
        state.Set(true);
        state.Set(true);
        state.Set(false);

        Assert.False(state.Paused);
        Assert.Equal(2, raised);
    }
}
