#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8080}"
IMAGE="${1:-inputs/01_corridor.png}"

JOB_JSON="$(
  curl --fail --silent --show-error \
    -X POST "$API_BASE/v1/perception/jobs" \
    -F "image=@$IMAGE" \
    -F 'request={
      "providers":{
        "geometry":"moge-2-vitl-normal",
        "reasoning":"qwen3-vl-8b-instruct",
        "detector":"grounding-dino-swin-t",
        "segmentation":"sam2.1-hiera-large"
      },
      "options":{
        "max_image_side":1024,
        "precision":"bf16",
        "sequential_unload":true,
        "return_depth":true,
        "return_normals":true,
        "return_instances":true,
        "return_walkability":true,
        "return_scene_graph":true
      }
    };type=application/json'
)"

JOB_ID="$(python -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$JOB_JSON")"
echo "job: $JOB_ID"

while true; do
  STATUS="$(curl --fail --silent --show-error "$API_BASE/v1/perception/jobs/$JOB_ID")"
  STATE="$(python -c 'import json,sys; print(json.load(sys.stdin)["state"])' <<<"$STATUS")"
  echo "state: $STATE"
  case "$STATE" in
    completed)
      BUNDLE_ID="$(python -c 'import json,sys; print(json.load(sys.stdin)["bundleId"])' <<<"$STATUS")"
      curl --fail --silent --show-error \
        "$API_BASE/v1/perception/bundles/$BUNDLE_ID" \
        -o response.json
      python verify_response.py response.json
      break
      ;;
    failed)
      echo "$STATUS"
      exit 1
      ;;
    *)
      sleep 2
      ;;
  esac
done
