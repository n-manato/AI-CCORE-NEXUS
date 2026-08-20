# World Perception Smoke Pack

This pack is designed to validate an ungated learned image-to-world perception service.

## Contents

- `inputs/01_corridor.png`
  - central walkable corridor;
  - walls must remain non-walkable;
  - three tree instances;
  - path should lead toward the distant arch.
- `inputs/02_water_bridge.png`
  - bridge deck should be walkable;
  - water should not;
  - foreground boat should be closer than the tower.
- `inputs/03_adjacent_towers.png`
  - two close towers must remain two distinct instances;
  - foreground path should remain walkable.
- `inputs/04_ambiguous_fantasy.png`
  - deliberately impossible geometry;
  - the system should preserve uncertainty rather than claim metric truth.
- `expected.json`
  - human-readable acceptance claims for each case.
- `request.example.json`
  - provider and runtime configuration.
- `run_smoke_test.sh`
  - example job submission and polling flow.
- `verify_response.py`
  - structural verifier for a `PerceptionBundleV2` response.

## Proposed service flow

```bash
export API_BASE=http://127.0.0.1:8080
bash run_smoke_test.sh inputs/01_corridor.png
```

The script:

1. uploads an image;
2. starts a perception job;
3. polls until completion;
4. downloads the resulting bundle;
5. verifies the required contract structure.

## Minimum output contract

The response must contain:

- geometry provider/version;
- depth;
- normals;
- confidence;
- unique object instances;
- connected walkable components;
- spawn candidates;
- scene relations;
- uncertainty;
- model invocation provenance.

## How to judge success

Structural success is only the first gate. Review the overlays and compare them to
`expected.json`. The strongest checks are:

1. corridor walls are not walkable;
2. bridge is walkable while water is not;
3. adjacent towers remain separate;
4. near/far ordering is correct;
5. the fantasy case is marked uncertain instead of being confidently fabricated.

## Ungated provider chain

This version uses:

1. `moge-2-vitl-normal` for depth, point maps, normals, and camera evidence.
2. `qwen3-vl-8b-instruct` for constrained concept and relation proposals.
3. `grounding-dino-swin-t` for text-conditioned object boxes.
4. `sam2.1-hiera-large` for box-prompted instance masks.

The detector and segmenter are separate deliberately. Grounding DINO identifies
*what and where*; SAM 2.1 traces the precise object boundary. The fusion layer
must preserve both scores and provenance.

## Recommended first run

Use `request.fixed-vocabulary.json` first. It disables VLM concept generation and
supplies a fixed world vocabulary to Grounding DINO. This makes the initial test
repeatable and isolates geometry, detection, masking, and walkability. Enable
Qwen only after this baseline passes.
