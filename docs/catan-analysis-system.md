# Catan "Stockfish for Catan" Analysis System

## 1. System architecture

The analysis pipeline is:

Game Logger -> State Evaluator -> Move Classifier -> Accuracy Aggregator -> Analysis UI

Every completed game retains:
- immutable game identity and timestamps
- board setup and ports
- player snapshots
- complete move/decision log
- before/after state snapshots for analysis
- analysis cache and engine version

Legacy games that do not contain usable move/state data remain in history and are marked "analysis unavailable" instead of throwing.

## 2. State evaluator

The evaluator uses the nine-factor formula:

rawValues[player] =
  w1 * victoryPoints
  + w2 * productionScore
  + w3 * expansionPotential
  + w4 * armyProgress
  + w5 * roadProgress
  + w6 * handEfficiency
  + w7 * tradeLeverage
  + w8 * blockingValue
  - w9 * vulnerabilityPenalty

Win likelihood is the softmax of player raw values.

The current repository weights are:
w1=1, w2=0.42, w3=0.32, w4=0.28, w5=0.24, w6=0.18, w7=0.16, w8=0.14, w9=0.10.

Production uses token pips multiplied by a resource scarcity multiplier based on how many players currently produce that resource.

Army progress models the Largest Army race using the current knight gap and a remaining-turn estimate.

Road progress combines current road control, probability of extension, and Longest Road ownership.

Hand efficiency rewards build readiness while penalizing 7+ card overflow and idle development cards.

Vulnerability applies a seven-risk penalty once the hand exceeds seven cards.

The current implementation deliberately keeps the evaluator deterministic for a given state and seedable where rollout randomness is injected.

## 3. Rollout / best-alternative engine

For a consequential move:
1. Build the legal move set for the current player.
2. Apply each candidate to a cloned state.
3. Run rollout simulations from the resulting state.
4. Advance dice/resource production, choose heuristic legal actions for future turns, and evaluate the resulting state.
5. Average the player's win probability over the rollout set.
6. Compare the actual move's win probability with the best alternative.

The lightweight browser analysis currently defaults to a bounded rollout count so first-open analysis remains responsive. The engine API accepts N and horizon overrides, so a deeper post-game mode can increase consequential simulations without changing the evaluator or classifier.

Low-stakes events such as roll/end-turn/discard can use cheap evaluation because they do not represent the same level of strategic choice.

### Classic tradeoffs

The evaluator explicitly accounts for:
- Largest Army vs. immediate building through army-progress + VP + development-card value.
- City now vs. saving resources through immediate production, VP gain, hand readiness and seven-risk.
- Trades that complete or materially reduce a build-cost gap receive objective value.
- Hoarding is penalized because a seven can remove resources.
- Development cards that are held but unused carry a small idle penalty.

## 4. Move classification

Equity loss is:

equityLoss = max(0, bestAlternativeWinProbability - actualMoveWinProbability)

The current buckets are:
- Excellent: < 0.5 percentage points
- Good: < 2.0
- Inaccuracy: < 5.0
- Mistake: < 12.0
- Blunder: >= 12.0

Brilliant is deliberately exceptional. It requires:
- a non-standard build action
- a decisive game-winning result
- very low equity loss
- a large positive win-probability swing

This keeps brilliant trades, blocks or robber decisions rare rather than allowing ordinary city/settlement/road builds to earn the label.

## 5. Accuracy

Per-player accuracy is derived from mean equity loss:

accuracy = clip(103.17 * exp(-0.044 * avgEquityLoss) - 3.17, 0, 100)

The cache stores the individual evaluations as well as the aggregate so the UI can show both overall accuracy and the worst moves.

## 6. Game history

The Analysis tab reads the existing local history automatically.

Each entry should expose:
- result and winner
- final scores
- mode
- date/time
- duration
- move count
- human accuracy and bot accuracy where available
- local/cloud sync state

Opening an eligible game:
- reuses cached analysis when present
- otherwise analyzes the saved move log on first open
- stores the result locally
- optionally writes the cached result to Supabase

Older/incomplete/disconnected games stay reviewable as saved results, but show an "analysis unavailable" explanation when move data is missing.

## 7. Sandbox board builder

The existing Analysis Lab now doubles as the sandbox:
- 1v1 = 15 VP
- 4-player = 10 VP
- official 19-hex board geometry is retained
- drag a Wood/Brick/Sheep/Wheat/Ore/Desert palette item onto any hex
- dropping onto an occupied hex replaces the resource
- clicking a placed hex exposes number-token editing
- valid tokens are 2–12 excluding 7
- CLEAR HEX removes the resource and token
- STANDARD BOARD restores the generated standard layout
- RANDOM FILL generates a fresh board using the existing board generator
- Start is blocked until every hex is complete and at least one desert exists

A custom sandbox game uses the same logger and analysis pipeline as a normal game.

## 8. Persistence

### Local-first
Every game and turn snapshot is written to browser local storage as the game progresses.

Local stores:
- catan.games.v2
- catan.sync.queue.v1
- catan.analysis.cache.v1

The local game key is a stable gameId generated at start.

### Cloud
Supabase is optional. When configured and signed in:
1. Save locally.
2. Upsert the game.
3. Upsert the board setup.
4. Replace/upsert move logs.
5. Upsert analysis.
6. Remove successful queue entries.

Failures remain in the retry queue and do not remove the local copy.

### Conflict handling
Records are merged by gameId, choosing the newest updatedAt/endedAt/startedAt record. This prevents the same match from appearing twice after a device reconnects.

### Supabase tables
- games
- board_setups
- move_logs
- game_analysis

All tables are scoped by authenticated user_id and protected by row-level security policies.

The repository contains a ready-to-apply migration at:
supabase/migrations/20260923_catan_analysis.sql

No Supabase project is currently connected to this development environment, so the migration is committed but has not been applied to a live project.

## 9. Component responsibilities

Analysis history:
- history list
- result/score/time cards
- auto-analysis trigger
- analysis cache lookup
- unavailable fallback

Move replay:
- previous/next move
- position board
- classification badge
- win-probability delta
- best-alternative explanation
- per-player accuracy

Sandbox:
- mode selector
- resource palette with draggable tiles
- board drop target
- number editor
- clear/replace controls
- validation summary
- standard/random fill
- start-game gate

Persistence:
- local snapshot writer
- analysis cache
- authentication panel
- cloud status indicator
- retry queue
- cloud/local conflict merger

## 10. Implementation phases

### Phase 1 — logging and identity
Completed foundations:
- stable game IDs
- local-first game snapshots
- move payloads
- stateBefore/stateAfter capture
- bot + human action logging
- completion persistence
- local/cloud queue primitives

### Phase 2 — evaluator
Completed foundation:
- nine-factor state evaluator
- softmax win likelihood
- current configured weights
- hand/overflow/development risk

### Phase 3 — rollout/classification
Core implementation:
- legal alternative generation
- rollout simulation
- equity-loss calculation
- six labels
- rare brilliant gate

Next tuning target:
- deeper consequential simulations
- randomized hidden-information sampling
- calibration against a labeled test corpus

### Phase 4 — history and accuracy
- automatic first-open analysis
- cache results
- human/bot/game accuracy
- legacy fallback
- move-by-move replay

### Phase 5 — sandbox
- drag/drop palette
- standard/random fill
- number validation
- custom-game launch
- same logger and analysis pipeline

### Phase 6 — cloud hardening
- connect a Supabase project
- apply migration
- configure auth
- enable background sync
- verify RLS
- test multi-device conflict/recovery

### Phase 7 — calibration
- tune thresholds on real games
- measure brilliant frequency
- compare engine choices with observed outcomes
- profile rollout count/horizon
- add regression fixtures for known tactical trades, blocks, robber plays, Army races and city-vs-save decisions
