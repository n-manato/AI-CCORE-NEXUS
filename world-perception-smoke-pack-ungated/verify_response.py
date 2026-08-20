#!/usr/bin/env python3
"""Minimal structural verifier for a PerceptionBundleV2 JSON response."""
from __future__ import annotations

import json
import sys
from pathlib import Path

def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)

if len(sys.argv) != 2:
    fail("usage: python verify_response.py response.json")

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

for key in ("source", "geometry", "instances", "navigation", "relations", "uncertainty", "provenance"):
    if key not in payload:
        fail(f"missing top-level key: {key}")

geometry = payload["geometry"]
for key in ("provider", "modelVersion", "depth", "normals", "confidence"):
    if key not in geometry:
        fail(f"missing geometry.{key}")

instances = payload["instances"]
if not isinstance(instances, list) or not instances:
    fail("instances must be a non-empty list")

ids = [item.get("id") for item in instances]
if len(ids) != len(set(ids)):
    fail("instance ids must be unique")

navigation = payload["navigation"]
if not navigation.get("connectedComponents"):
    fail("no connected walkable components")
if not navigation.get("spawnCandidates"):
    fail("no spawn candidates")

for candidate in navigation["spawnCandidates"]:
    if candidate.get("confidence", 0) < 0 or candidate.get("confidence", 0) > 1:
        fail("spawn confidence outside [0,1]")

if not isinstance(payload["provenance"], list) or not payload["provenance"]:
    fail("model provenance is required")

print("PASS: structural PerceptionBundleV2 checks succeeded")
