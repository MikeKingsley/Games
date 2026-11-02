using Games.Client.Services;

namespace Games.Tests;

public class UpdateServiceTests
{
    [Fact]
    public void Shows_when_an_update_arrives_hides_when_dismissed_and_shows_again_for_the_next_one()
    {
        var service = new UpdateService(null!);
        var raised = 0;
        service.Changed += () => raised++;

        Assert.False(service.Visible);
        service.OnUpdateAvailable();
        service.OnUpdateAvailable();
        Assert.True(service.Visible);
        Assert.Equal(1, raised);

        service.Dismiss();
        service.Dismiss();
        Assert.False(service.Visible);
        Assert.Equal(2, raised);

        service.OnUpdateAvailable();
        Assert.True(service.Visible);
        Assert.Equal(3, raised);
    }
}
