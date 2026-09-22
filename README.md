# MONOPOLY

A local browser Catan-style strategy board game with a 1v1 PVBot mode and a 4-player mode.

## Gameplay

- 1v1 PVBot: 15 VP, Balanced Dice, Friendly Robber, no player trading.
- 4-player: 10 VP, standard player trading and random dice.
- Development cards, ports, bank trade, Largest Army and Longest Road remain enabled.
- Hidden opponent resources remain hidden in normal play.
- Existing Hard/Impossible historical-memory behaviour is intentionally preserved.

## Bot planning

V75 uses one authoritative multi-turn strategic plan for settlement, road, city and resource acquisition. The planner evaluates legal road paths, target survival, turn order, resource deficits, ports, trade progress, development-card combinations, race pressure, robber impact and opponent contention. Action search is stratified so settlements, roads, cities and trades cannot starve one another behind a single global candidate cutoff.

## Local run

```bash
npm install
npm run dev
```

## Verification

```bash
npm run verify
```

## Production build

```bash
npm run build
```

## GitHub Pages

Pushes to `main` verify the game and deploy `dist` to GitHub Pages. The workflow deliberately avoids `setup-node` npm-cache mode so deployment does not require a pre-existing `package-lock.json`.

Developed by Aryan Mohammed.