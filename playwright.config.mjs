import { defineConfig } from '@playwright/test';

// Uses the installed Microsoft Edge so no browser download is needed. Run with `npm run test:e2e`.
export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    use: { baseURL: 'http://localhost:5211', channel: 'msedge', viewport: { width: 1024, height: 768 }, launchOptions: { args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
    webServer: {
        command: 'dotnet run --project Games.Client --urls http://localhost:5211 --no-launch-profile',
        url: 'http://localhost:5211',
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
