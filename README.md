# SuperPong — AI-Powered Table Tennis Umpire & Commentary

> Real-time voice umpire, ball tracking, and live score overlay — powered by Vision Agents SDK + Gemini Realtime.  
> Built for the [WeMakeDevs Vision Hackathon](https://www.wemakedevs.org/hackathons/vision).

---

## What is SuperPong?

SuperPong turns your phone or laptop camera into a fully autonomous table tennis umpire. Point the camera at the table, say **"Hey SuperPong"**, and the AI takes over — it watches the ball, calls points, keeps score, and delivers live commentary, all with your voice or completely hands-free.

No dedicated hardware. No manual scorekeeping. Just the game.

---

## How It Works

```
┌─────────────────────────┐    WebRTC (Stream Edge)    ┌──────────────────────────────┐
│   React PWA (Vite)      │ ◄────────────────────────► │  Vision Agents Backend       │
│                         │                             │                              │
│  • Live HUD overlay     │   Camera + Mic stream  ──►  │  • Gemini Realtime (voice+   │
│  • Voice wake word      │                             │    vision, 5 fps)            │
│  • Manual score tap     │   Voice commentary    ◄──   │  • YOLO BallTrackingProcessor│
│  • Post-match stats     │   + function calls          │  • Function calling tools    │
└─────────────────────────┘                             └──────────────────────────────┘
          │                                                          │
          │              Fallback (no backend)                       │
          └────────── Browser-side Gemini Live API ─────────────────┘
```

### Step-by-Step Flow

1. **Setup** — Enter player names, choose points-to-win (11 or 21), and the best-of format.
2. **Wake Word** — The frontend passively listens for *"SuperPong"*. When heard, it fires up the AI connection.
3. **Backend Check** — The `useAgentConnection` hook pings `/health` on the backend. If Vision Agents SDK is running, it creates a full server-side agent session (WebRTC + Gemini Realtime). If not, it falls back seamlessly to a browser-side Gemini Live session.
4. **Live Vision** — The `BallTrackingProcessor` processes WebRTC video frames in real time using YOLO, detecting ball position, rally activity, and which side lost the point.
5. **Vision Events** — On `RALLY_END`, the tracker fires an event into the Gemini agent's context with the losing side. Gemini then calls `add_point()` for the winner.
6. **Voice Commands** — The player can also speak commands directly: *"Point to Alex"*, *"Undo"*, *"Pause"*, *"What's the score?"*.
7. **Function Calling** — Every score mutation goes through Gemini's function-calling tools (`add_point`, `pause_match`, `override_score`, etc.), keeping the AI and UI state perfectly in sync.
8. **Commentary** — Gemini delivers punchy, real-time voice commentary after each point.
9. **Post-Match** — A summary screen shows the winner, point win percentages, and elapsed time.

---

## Vision Agents SDK Integration

SuperPong is built on top of **[Vision Agents SDK](https://visionagents.ai)** as its core AI engine. Here is exactly how each part of the SDK is used:

| SDK Feature | How SuperPong uses it |
|---|---|
| `getstream.Edge()` | WebRTC transport from the browser camera to the Python backend |
| `gemini.Realtime(fps=5)` | Single multimodal session handling voice input, speech output, and video understanding together |
| `VideoProcessor` (custom) | `BallTrackingProcessor` subclasses `VideoProcessor` to intercept raw frames, run YOLO, and emit scoring events |
| `@llm.register_function()` | Registers `add_point`, `undo_last_point`, `pause_match`, `resume_match`, `end_match`, `override_score`, `set_serving`, `get_current_score` as callable tools |
| `agent.send_text()` | Used for two purposes: injecting silent `[SYSTEM STATE UPDATE]` messages so the agent always knows the true score, and forwarding `[VISION EVENT]` messages from the ball tracker |
| `AgentLauncher` / `Runner` | Handles HTTP server mode (`uv run agent.py serve`) with multi-session lifecycle, `/sessions`, `/health`, and `/ready` endpoints |

### The Agent Definition

```python
llm = gemini.Realtime(fps=5, model="gemini-2.5-flash")

ball_tracker = BallTrackingProcessor(
    event_callback=lambda evt: _on_tracker_event(match_id, evt),
)

agent = Agent(
    edge=getstream.Edge(),
    agent_user=User(name="SuperPong", id="superpong-agent"),
    instructions=instructions,   # loaded from umpire_instructions.md
    llm=llm,
    processors=[ball_tracker],   # YOLO runs every frame
)
```

### Ball Tracking Processor

The `BallTrackingProcessor` is a custom `VideoProcessor` that:

- Runs **YOLO** on each incoming video frame to detect the ball
- Maintains a **trajectory predictor** using weighted regression to bridge occlusion gaps
- Tracks **rally state** — detecting when a rally starts and ends based on ball position and frame continuity
- Determines **which side lost the rally** by tracking where the ball was last seen before going out
- Emits `RALLY_END` and `RALLY_START` events to the Gemini agent via `agent.send_text()`

### Dual-Mode Fallback

If the Vision Agents SDK backend is not running, the frontend's `useAgentConnection` hook detects this via a `/health` endpoint check and automatically switches to a **browser-native Gemini Live** connection using `@google/genai`. The same voice commands, function calls, and UI updates work identically — the user never notices the difference.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS v4 |
| Animations | Motion (Framer Motion) |
| Icons | Lucide React |
| AI SDK (Frontend) | `@google/genai` — Gemini Live browser fallback |
| Backend | Python, Vision Agents SDK |
| LLM | Gemini 2.5 Flash — Realtime voice + vision + STT/TTS |
| Video Transport | Stream Video WebRTC via `getstream.Edge()` |
| Ball Tracking | Ultralytics YOLO (custom `VideoProcessor`) |
| Wake Word | Browser Web Speech API (passive listening) |

---

## Project Structure

```
superpong/
├── README.md
├── metadata.json                # App name + permission declarations
├── package.json                 # Frontend deps + run scripts
├── index.html
├── vite.config.ts
├── src/
│   ├── App.tsx                  # Screen router (Setup → Match → PostMatch)
│   ├── index.css                # Tailwind v4 design tokens
│   ├── store/
│   │   └── matchState.ts        # Central match state + localStorage persistence
│   ├── components/
│   │   ├── SetupScreen.tsx      # Player names, points config, best-of
│   │   ├── LiveHud.tsx          # Main match screen — camera + overlay + voice
│   │   └── PostMatch.tsx        # Results, stats, win percentages
│   └── hooks/
│       ├── useAgentConnection.ts  # Smart fallback: backend agent OR browser Gemini
│       ├── useGeminiLive.ts       # Browser-side Gemini Live API (fallback)
│       └── useWakeWord.ts         # Passive "SuperPong" wake word listener
└── backend/
    ├── agent.py                 # Vision Agents server — sessions, REST API, state
    ├── umpire_instructions.md   # Gemini system prompt for the AI umpire
    ├── pyproject.toml           # Python deps (vision-agents, fastapi, ultralytics)
    └── processors/
        ├── __init__.py
        └── ball_tracker.py      # YOLO VideoProcessor with trajectory prediction
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+ with `uv` (recommended) or pip
- A webcam
- API keys: `GEMINI_API_KEY` (required), `STREAM_API_KEY` + `STREAM_API_SECRET` (for full agent mode)

### Run (Frontend Only — Browser Fallback Mode)

The app works out-of-the-box with just a Gemini API key and no backend:

```bash
cd superpong
npm install
echo "GEMINI_API_KEY=your_key_here" > .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — voice + scoring works via browser-side Gemini Live.

### Run with Full Vision Agents Backend

```bash
# Terminal 1 — Frontend
npm install
npm run dev

# Terminal 2 — Vision Agents Backend
cd backend
cp .env.example .env     # fill in STREAM_API_KEY, STREAM_API_SECRET, GOOGLE_API_KEY
uv sync
uv run agent.py serve --host 0.0.0.0 --port 8000
```

Or run everything at once:

```bash
npm run dev:all
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API key (browser fallback + backend) |
| `STREAM_API_KEY` | For full agent mode | Stream Video API key |
| `STREAM_API_SECRET` | For full agent mode | Stream Video API secret |
| `VITE_AGENT_URL` | No | Backend URL (default: `http://localhost:8000`) |

---

## AI Umpire Capabilities

The Gemini agent operates under a strict umpire persona defined in `umpire_instructions.md`:

**Voice Commands it understands:**
- Score: *"Point to [name]"*, *"Set score to 5-3"*, *"Undo that point"*
- Match flow: *"Pause"*, *"Resume"*, *"End the match"*
- Info: *"What's the score?"*, *"Who's serving?"*
- Rename: *"Call player 2 Alex from now on"*

**Vision-driven scoring:**
- Watches every frame at 5 fps
- Detects `RALLY_END` events from the ball tracker
- Automatically awards the point to the correct player
- Commentary triggers after every point

**State awareness:**
- Receives silent `[SYSTEM STATE UPDATE]` messages on every manual score tap
- Never gets out of sync with the UI
- Respects ITTF deuce rules, serve rotation, and best-of set structure

---

## Features

| Feature | Status |
|---|---|
| Voice-commanded scoring | ✅ |
| Wake-word activation ("SuperPong") | ✅ |
| YOLO ball tracking + auto-scoring | ✅ |
| Live commentary via Gemini Realtime | ✅ |
| Manual tap-to-score fallback | ✅ |
| Full ITTF table tennis rules (deuce, serve rotation, sets) | ✅ |
| Post-match analytics | ✅ |
| Browser-only mode (no backend required) | ✅ |
| Full Vision Agents + WebRTC backend mode | ✅ |
| Mobile landscape lock | ✅ |

---

## License

MIT — Built for the WeMakeDevs Vision Hackathon 2026.
