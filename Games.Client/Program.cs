using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Games.Client;
using Games.Client.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddScoped<GameRegistry>();
builder.Services.AddScoped<ISettingsStore, LocalStorageSettingsStore>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<ProgressService>();
builder.Services.AddScoped<FullscreenService>();
builder.Services.AddScoped<PauseState>();
builder.Services.AddScoped<UpdateService>();

await builder.Build().RunAsync();
