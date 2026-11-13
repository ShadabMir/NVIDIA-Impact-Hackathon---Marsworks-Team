# Text to speech (branch `feature/text-to-speech`)

Adds spoken output using a speech model running **on the DGX Spark**. If the Spark model is not
reachable, the frontend falls back to the browser's own voice, so the demo never goes silent.

This branch only **adds** files. No existing file was changed:

| File | Purpose |
| --- | --- |
| `backend/app/tts.py` | `POST /api/v1/tts` and `GET /api/v1/tts/health` |
| `backend/app/main_tts.py` | The existing API plus the TTS routes |
| `backend/tests/test_tts.py` | Tests with a fake speech server |
| `src/tts/speak.js` | `speak(text)` helper: Spark first, browser voice as fallback |
| `src/tts/TtsDemo.jsx`, `src/tts/main.jsx`, `tts.html` | Test page at `/tts.html` |

## 1. Start the speech model on the Spark (Chatterbox NIM)

Use the NGC API key **on the Spark only**. Never commit it or put it in a `VITE_` variable.

```bash
export NGC_API_KEY=<your key>
echo "$NGC_API_KEY" | docker login nvcr.io -u '$oauthtoken' --password-stdin

docker run -d --name chatterbox --runtime=nvidia --gpus '"device=0"' --shm-size=8GB \
  -e NGC_API_KEY -e NIM_HTTP_API_PORT=9000 -e NIM_GRPC_API_PORT=50051 \
  -e NIM_TAGS_SELECTOR="name=chatterbox-tts-multilingual,batch_size=8" \
  -p 9000:9000 -p 50051:50051 \
  nvcr.io/nim/nvidia/chatterbox-tts-multilingual:latest

curl http://localhost:9000/v1/health/ready      # wait for {"status":"ready"}
```

Notes from NVIDIA's documentation:

- On DGX Spark only `batch_size=8` works; 32 or 64 fail to deploy.
- It needs about 45 GB of GPU memory. Check `nvidia-smi` if Nemotron is loaded too.
- The first start downloads the model and can take up to 30 minutes.
- English voice: `Chatterbox-Multilingual.en-US.Male` (no British voice).
- Maximum 500 characters per request. The backend splits longer text into sentences.
- If the image name does not pull, check the exact name on NGC.

Do **not** use the hosted build.nvidia.com endpoint: the hackathon rules require a local model.

## 2. Run the backend with the TTS routes

Add to `backend/.env`:

```text
TTS_BASE_URL=http://127.0.0.1:9000
# Optional:
# TTS_VOICE=Chatterbox-Multilingual.en-US.Male
# TTS_LANGUAGE=en-US
# TTS_TIMEOUT_SECONDS=30
```

If the API runs on a laptop, open an SSH tunnel to the Spark's port 9000 and keep
`TTS_BASE_URL=http://127.0.0.1:9000`.

Start the API with `main_tts` instead of `main` (every existing route still works):

```sh
cd backend
python -m uvicorn app.main_tts:app --host 0.0.0.0 --port 8000
```

Check: `GET http://localhost:8000/api/v1/tts/health`.

## 3. Try it

```sh
npm run dev
```

Open `http://localhost:5173/tts.html`, press **Listen**. The page says whether the Spark
model or the browser voice spoke.

## 4. Use it in the app (later, when the team agrees)

```javascript
import { speak, stopSpeaking } from "./tts/speak";

<button onClick={() => speak(alertText)}>🔊 Listen</button>
```

Suggested places: the disruption alert, each route step, and the extracted appointment details.
Keep the text visible on screen, and add `aria-live="assertive"` to the alert box for screen readers.

## Swapping the model

Any local TTS server can sit behind `/api/v1/tts`. To use Kokoro or Piper instead, change only
`backend/app/tts.py`; the frontend stays the same.

## Tests

```sh
cd backend
python -m pytest -q tests/test_tts.py
```

The tests use a fake speech server. They do not exercise the real Chatterbox container or the GPU.
