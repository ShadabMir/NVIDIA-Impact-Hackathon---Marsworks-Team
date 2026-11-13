# Voice input: speak your appointment details

People can say their appointment details instead of typing them, e.g. *"Neuro rehab at the
Hallamshire, next Monday at half ten, from Walkley"*. Speech recognition runs on the **DGX Spark
GPU** (Whisper), Nemotron turns the words into form fields, and the app reads them back. Nothing is
used until the person checks the form and ticks "I have checked…".

## How it works

| Step | Where | What happens |
| --- | --- | --- |
| 1. Record | Browser (`src/voice/VoiceInput.jsx`) | Microphone with noise suppression, a level meter, and a 60 s limit |
| 2. Convert | Browser (`src/voice/wav.js`) | Converts to 16 kHz mono WAV. Too short or silent recordings are rejected here and never uploaded |
| 3. Send | Backend `POST /api/v1/appointments/voice` (`backend/app/voice.py`) | Checks the file, then forwards it to the speech service |
| 4. Transcribe | **Spark**: `spark/asr_server.py` (Whisper large-v3-turbo on the GB10 GPU) | Silence gate; normalises quiet audio; drops phrases Whisper invents from noise ("Thank you for watching") |
| 5. Understand | **Spark**: Nemotron through Ollama (JSON schema) | Picks out hospital, clinic, date, appointment time, arrival time and start place, working out "next Monday" and "half ten" from today's date |
| 6. Check | Backend | Each value is checked (details below) |
| 7. Confirm | Browser | Editable transcript, what was understood, and warnings. **Use these details** fills only the fields that were heard and reads them back aloud. The user still ticks the box |

**What step 6 checks:**
- **Impossible dates or times are dropped.** Past dates, dates more than a year away, and times
  outside 06:00–21:00 are flagged.
- **A hospital other than the Royal Hallamshire** is flagged.
- **No arrival time given:** arrival is suggested as 15 minutes early, and the user is told.
- **Missing values** are named, so the user knows what to type.

**If the transcript is wrong,** the user can edit it and press **Read my corrected words again**
(`POST /api/v1/appointments/voice/text`).

## When things go wrong

| Situation | What the user sees |
| --- | --- |
| No microphone, permission denied, or microphone busy | A specific message; typing still works |
| Recording too short, or silent | "That was too short…" or "We didn't hear anything…" (not uploaded) |
| Noise only / Whisper invents text | "Speech was too unclear…", nothing filled |
| Few words recognised | A warning, with the transcript editable |
| Speech service not set up (`ASR_BASE_URL` blank) | Voice section shown with the button disabled: "Voice input isn't switched on yet…"; Settings → Voice input says how to set it up |
| Speech service down or loading | Button disabled, "Voice input isn't available right now"; mid-use: "The speech service isn't reachable…" |
| Speech service slow (more than 60 s) | "The speech service took too long…" |
| Nemotron down, or returns bad output | Transcript shown; "The AI couldn't read the details…"; nothing auto-filled |
| Impossible or doubtful values | Dropped or flagged with a warning |

Audio is processed in memory only; it is never saved on the laptop or the Spark.

## Setup

**1. On the Spark (once).** Install into the `~/asr` environment that already has PyTorch:

```bash
~/asr/bin/pip install numpy transformers fastapi "uvicorn[standard]" python-multipart
```

**2. Copy the service to the Spark.** On the laptop, from the repository root:

```powershell
scp spark/asr_server.py user11@spark11.local:~/asr_server.py
```

**3. Start it on the Spark,** and leave it running:

```bash
nohup ~/asr/bin/python ~/asr_server.py > ~/asr.log 2>&1 &
```

The first start downloads Whisper (about 1.6 GB) and loads it on the GPU. Check its status:

```bash
curl -s http://127.0.0.1:9100/health
```

Wait until it says `"status":"ready"` and `"device":"NVIDIA GB10"`. Problems are shown in
`~/asr.log`. To stop it, run `pkill -f asr_server.py`.

**4. Tunnel both services from the laptop.** This replaces the window 1 command in the README:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:11435:127.0.0.1:11434 -L 127.0.0.1:9101:127.0.0.1:9100 user11@spark11.local
```

**5. In `backend\.env`,** set `ASR_BASE_URL=http://127.0.0.1:9101`, then restart `uvicorn`.

**6. Check it.** `http://localhost:8000/api/v1/appointments/voice/health` should show
`"status":"ready"`. The 🎤 button appears on the appointment step.

**Without the Spark:** run the same script on the laptop with a smaller model and the CPU, and set
`ASR_BASE_URL=http://127.0.0.1:9100`. In a separate venv:

```powershell
pip install torch numpy transformers fastapi "uvicorn[standard]" python-multipart
```

```powershell
$env:ASR_MODEL="openai/whisper-base.en"; python spark/asr_server.py
```

## Tests

| Command | Covers |
| --- | --- |
| `cd backend; python -m pytest -q` | 30 voice tests: every failure above, value checks, and a backend-to-real-service contract test. The contract test is **skipped** if `numpy` isn't installed (it's a speech-service dependency, not a backend one) |
| `python -m pytest spark -q` | 16 speech service tests (Whisper stubbed): silence, invented phrases, bad or long audio, stereo and 48 kHz, load failure, library differences. Needs `pip install numpy fastapi httpx pytest python-multipart` (no PyTorch needed) |
| `npm run test:navigation` | WAV encoding, silence and length checks, microphone error messages, read-back text |

These tests don't run the real Whisper model. On the Spark, `/health` reports `ready` only after a
real Whisper run on the GPU (warm-up) has succeeded.
