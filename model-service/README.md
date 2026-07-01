# Local AI Gateway — Python Model Sidecar

Real CPU/GPU backends for the capabilities Ollama does not serve: OCR, object
detection, speech-to-text (STT), text-to-speech (TTS), background removal.

The Next.js gateway proxies to this service (see `src/lib/sidecar.ts`). `/health`
reports which capabilities are actually available, and the gateway's **Sync**
button turns those into live "Online" labels.

## Setup

```bash
cd model-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt          # rembg, ultralytics(YOLO), faster-whisper
# optional extra backends:
pip install "paddleocr<3.0" paddlepaddle  # OCR
pip install kokoro soundfile              # TTS (also needs: sudo apt install espeak-ng)
```

## GPU (CUDA)

`pip install -r requirements.txt` pulls a torch wheel that may not match the host
driver. For GPU on NVIDIA driver 570.x (CUDA 12.x), install the cu124 build:

```bash
.venv/bin/pip install "torch==2.6.0" "torchvision==0.21.0" \
  --index-url https://download.pytorch.org/whl/cu124
.venv/bin/python -c "import torch; print(torch.cuda.is_available())"   # -> True
```

`run.sh` puts torch's bundled CUDA libs on `LD_LIBRARY_PATH` so faster-whisper
(ctranslate2) finds cuDNN/cuBLAS. detect (YOLO) + STT (whisper) then run on GPU;
OCR (RapidOCR) and background removal (rembg) stay on CPU via onnxruntime.

## Run

```bash
cd model-service
./run.sh                 # GPU-aware launch (recommended)
# or plain: .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
# health:   curl http://127.0.0.1:8000/health   ->  {"cuda": true, ...}
```

Then in the gateway UI: **Model Runtime → Sync** to refresh the labels.

## Endpoints

| Method | Path          | Backend         | Gateway route                     |
| ------ | ------------- | --------------- | --------------------------------- |
| POST   | `/remove-bg`  | rembg           | `/v1/images/remove-background`    |
| POST   | `/detect`     | Ultralytics YOLO| `/v1/vision/detect`               |
| POST   | `/stt`        | faster-whisper  | `/v1/audio/transcriptions`        |
| POST   | `/ocr`        | PaddleOCR       | `/v1/vision/ocr`                  |
| POST   | `/tts`        | Kokoro          | `/v1/audio/speech`                |
| GET    | `/health`     | —               | (used by Sync)                    |

## GPU

Backends run on CPU by default. For GPU acceleration, the host's nvidia driver
must match the kernel module (currently mismatched — `nvidia-smi` fails). After
fixing the driver, torch/onnxruntime will use the GPU automatically.

Models are loaded lazily on first request and download their weights on first use
(rembg u2net ~170MB, YOLO ~6MB, whisper small ~480MB).
