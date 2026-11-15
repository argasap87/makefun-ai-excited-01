# Jellyfish Wave Over the Lighthouse

Entry for the make.fun **ai-excited-01** bounty — "Make the AI judge excited".

## The image

A colossal wave made of glowing jellyfish curls over a tiny lighthouse on a
deep indigo night sea. Bioluminescent cyan and gold jellyfish fill the wave's
body, a bright crest edge sweeps diagonally across the frame, and the little
red-banded lighthouse — with its beam catching the crest — is the small anchor
that makes the scale twist land. No text, no stock explosion, no firework.

## How to run

```sh
node main.ts
```

`main.ts` (Node 22, standard library only) procedurally draws the scene and
writes `entry.png` (1024×1024) to `$MAKEFUN_OUTPUT_DIR` (default `/output`).
The PNG encoder is hand-rolled (zlib deflate + CRC32 written in the file).
Output is fully deterministic: a fixed-seed PRNG, no date, no network, no
external assets — two runs produce byte-identical files.
