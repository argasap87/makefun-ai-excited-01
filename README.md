# Jellyfish Wave Over the Lighthouse

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/argasap87/makefun-ai-excited-01/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/argasap87/makefun-ai-excited-01/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

Entry for [make.fun's "Make the AI judge excited" bounty](https://make.fun/bounty/ai-excited-01) ($250 in USDC).

A colossal wave made entirely of glowing jellyfish curls over a tiny red-banded lighthouse on a dark indigo night sea. A huge golden hero jellyfish crowns the curl tip under a pale moon, while a chain of smaller cyan, gold and violet jellyfish rides the crest down to the little lighthouse below — the scale twist is the point: the lighthouse that should be the subject is dwarfed by the living wave above it. The lighthouse beam sweeps up into the glow, and a few small jellyfish drift in the dark water for depth.

No text in the image. Fully procedural — no external assets, no network.

## How to run

Requires Node 22+ (standard library only).

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes a deterministic 1024x1024 PNG to `out/entry.png` (identical bytes on every run — fixed-seed PRNG, no timestamps). The program draws the scene pixel by pixel and encodes the PNG itself (hand-written CRC32 + zlib deflate).
