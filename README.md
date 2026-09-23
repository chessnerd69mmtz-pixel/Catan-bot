# Catan Bot

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

## Robber and trading updates

- Robber theft is resolved against the player occupying the destination hex, never the player moving the robber.
- Robber theft uses one random physical resource card from the selected adjacent victim.
- Player trading uses a Colonist-style three-section give/exchange/receive flow with bank/player tabs.
- Bots can proactively offer trades to human players when the offer advances an immediate strategic objective while giving away surplus resources.


## Catan Engine game analysis

Completed matches are stored in local game history with the frozen final board, players, logs, duration and per-move engine metadata.

### Move scoring

Every recorded action is compared with the highest-scoring legal action from the same Catan Engine candidate set. The normalized engine loss is:

`loss = clamp((bestScore - chosenScore) / max(20, abs(bestScore) + 20), 0, 1)`

Classification thresholds:
- **Excellent:** loss <= 1.5%
- **Good:** loss <= 5%
- **Inaccuracy:** loss <= 12%
- **Mistake:** loss <= 22%
- **Blunder:** loss > 22%

**Brilliant** is intentionally rare: the move must win the game, be a non-building/non-development action, swing the engine's win-likelihood by at least 22 percentage points, and have engine loss <= 12%.

Accuracy is the mean move-classification score: Blunder 0, Mistake 20, Inaccuracy 50, Good 75, Excellent 92, Brilliant 100.

### Analysis UI

The Analysis tab lists completed games with result, timestamp, duration, move count and accuracy. Opening a game provides move-by-move replay, the engine's top line, engine loss, win-likelihood swing, and separate human/bot accuracy.

### Custom Analysis Lab

The Analysis section provides **1v1 / 15 VP** and **4-player / 10 VP** board-builder modes. You can edit terrain, number tokens, ports, starting pieces, cards, VP, bank and awards. **Analyze Position** reviews the configured position; **Play & Analyze** launches a sandbox game where Player 1 is human and the remaining sides are engine opponents, with the same analysis frames recorded as normal games.

## Advanced Catan AI

Version 7 adds an AI Lab built on the existing game engine. It deliberately does **not** include an AI tournament/bracket mode.

- **Five bot personalities:** Maya (balanced), Rook (expansionist), Nova (port/trader), Atlas (knight/raider) and Vega (resource diversifier). Personality bias is applied inside the live bot action and settlement scoring paths.
- **Persistent ELO:** ranked completed games update browser-local ELO ratings with a K-factor of 32. Ratings are idempotent per game and cover the human profile plus bot personalities.
- **Monte Carlo placement lab:** bounded randomized placement rollouts produce mean, P10/P90 and stability measures for candidate intersections.
- **Settlement heatmaps:** completed-game analysis frames can be converted into an explainability heatmap showing legal candidate intersections, production, resource diversity, numbers and ports.
- **Replay/history integration:** the existing completed-game analysis and replay pipeline remains the source of saved positions and move frames.
- **Performance profiling:** the AI Lab summarizes completed bot games, win/loss/draw records, decision accuracy and settlement-choice volume without creating a tournament ladder.

The Advanced AI Lab is opened from the in-game navigation under **AI Lab**.

## Safe Bot Self-Learning

Catan Bot includes a persistent, mathematically guarded feedback-learning layer. From the Game Analyzer, a user can describe a concrete alternative such as settlement at 17, road 42, city at 9, buy development, play Knight, or trade wood for wheat.

Feedback is never trusted directly. The learning engine converts the suggestion into a legal candidate move, benchmarks it against the current mathematical best using paired rollout simulations, and requires both:
- a minimum measured improvement of 1 percentage point of modeled win likelihood, and
- a positive 95% confidence lower bound for the paired improvement.

Suggestions that are illegal, already equal to the current best, or statistically inconclusive are rejected and never added to bot knowledge.

Accepted feedback becomes a shared persistent training example in localStorage, updates a lightweight contextual linear model, and is available across future games. Before any learned suggestion can influence a bot decision, the bot performs the same fresh mathematical verification against the current engine best. A learned move therefore cannot bypass the mathematical safety gate.

The Analyzer shows the number of verified lessons, model steps, measured gain and confidence bound. Verified learned decisions are also logged during gameplay. Opening-placement suggestions use the same safety gate.