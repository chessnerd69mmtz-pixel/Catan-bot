# MONOPOLY

A local browser Catan-style strategy board game with 1v1 PVBot and 4-player bot gameplay.

## Run locally

```bash
npm install
npm run dev
```

## Verify the game and bot

```bash
npm run verify
```

`npm run verify` checks the full gameplay regression suite, feature audit, and the V76 low-latency bot benchmark for both 1v1 and 4-player scenarios.

## V76 bot engine

The bot uses a single persistent strategic plan for settlement, road, city, and resource acquisition objectives while keeping the main-thread search bounded. Expensive opening and deep-search paths are cached/lazy, candidate classes have separate search budgets, and the UI yields between bot actions. The bot's planning budget remains 4.5 seconds with a 4.8-second safety cutoff, while the performance benchmark enforces substantially lower normal decision latency.

The intentionally preserved Hard/Impossible historical hidden-resource memory behaviour remains unchanged.

## GitHub Pages

Pushes to `main` run source checks, gameplay regressions, the performance benchmark, the production build, and publish `dist` to the `gh-pages` branch.

If GitHub Pages is configured to serve `gh-pages` from the repository root, the game is available at:

`https://chessnerd69mmtz-pixel.github.io/Catan-bot/`

Developed by Aryan Mohammed.