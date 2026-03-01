<div align="center">

# 🏓 SuperPong

### Your AI-Powered Table Tennis Umpire

**Just point your camera at the table. SuperPong handles the rest.**

Voice commands · Live ball tracking · Real-time commentary · Hands-free scoring

[![Live Demo](https://img.shields.io/badge/🌐_Play_Now-superpong--website.vercel.app-10b981?style=for-the-badge)](https://superpong-website.vercel.app/)
[![Built with Gemini](https://img.shields.io/badge/Built_with-Gemini%202.5%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![Vision Agents](https://img.shields.io/badge/Powered_by-Vision_Agents_SDK-FF6F00?style=for-the-badge)](https://visionagents.ai)

</div>

---

## 🎬 See it in Action

Ever wonder what an AI umpire looks like? Watch this short demo:

<div align="center">

![Demo-video](https://github.com/user-attachments/assets/c1052c07-ac58-473d-bf04-7c3c50b0567e)

> *Can't see the video above? [Watch the demo on YouTube 📺](https://youtu.be/EGWD7-OZPSo)*

</div>

---

## 💡 What is SuperPong?

SuperPong turns your phone or laptop camera into a **fully autonomous, professional table tennis umpire**. No wearables, no sensors, and absolutely no manual scorekeeping. Just aim your device at the table, say *"Hey SuperPong"*, and let the AI take over.

It watches the ball, calls every point, keeps track of the score, rotates serves, handles deuce rules, and even delivers live, conversational commentary—all powered by real-time voice and vision AI. 

### ✨ The Magic

- 🗣️ **Talk to it like a real person** — *"Point to Alex"*, *"Wait, what's the score?"*, *"Undo that point"*
- 👁️ **It literally watches the game** — YOLO tracks the ball at high speeds and automatically detects when a rally ends.
- 🎙️ **It talks back** — Real-time, smart voice commentary right after every rally.
- 📱 **Works anywhere** — Runs beautifully on your phone, tablet, or laptop. No special hardware required.
- ⚡ **Lightning Fast Connections** — With smart auto-booting, it seamlessly connects to Vision Agents, or falls back to browser-native Gemini Live immediately if the backend goes down!

---

## 🚀 Try It Now

### 🌐 Live Deployment

**Ready to play? Visit our live website:**  
👉 **[superpong-website.vercel.app](https://superpong-website.vercel.app/)**

Just open it on your phone, point it at the table, and start playing!

### 🖥️ Run Locally

**Browser-only mode** (no backend needed):

```bash
git clone https://github.com/emsoumik/SuperPong.git
cd SuperPong
npm install
```

1. **Configure Environment**: Create a `.env` file in the root.

   ```bash
   VITE_GEMINI_API_KEY=your_gemini_api_key_here
   ```
   *Reason: Authenticates the browser-side Gemini Live for voice interactions.*

2. **Start Frontend**:
   ```bash
   npm run dev
   ```
   *Reason: Launches the React PWA (usually at [localhost:5173](http://localhost:5173)). Voice and manual scoring work instantly.*

### 🧠 Full Vision Agent Mode

For automated ball tracking and vision-powered scoring, you must also run the Python backend:

1. **Initialize Backend**:
   ```bash
   cd backend
   cp .env.example .env  # Add STREAM_API_KEY & GOOGLE_API_KEY
   uv sync
   ```
   *Reason: Sets up the Python environment and AI model credentials using `uv`.*

2. **Start the Agent**:
   ```bash
   # Make sure you are inside the backend directory!
   uv run agent.py serve --port 8080
   ```
   *Reason: Starts the Vision Agent which uses YOLO and Gemini 2.5 Flash to track the ball and score rallies.*
```

Or just:

```bash
npm run dev:all
```

---

## 🏗️ How It Works

```
 Your Camera                                           The Brain
┌─────────────────────┐                        ┌───────────────────────────┐
│                     │   WebRTC / Audio        │                           │
│   React PWA         │ ◄────────────────────►  │   Vision Agents Backend   │
│                     │                         │                           │
│   • Live HUD        │   Camera frames  ───►   │   • Gemini 2.5 (voice +   │
│   • Wake word       │                         │     vision, 5 fps)        │
│   • Score overlay    │   Voice + tools  ◄───   │   • YOLO ball tracker     │
│   • Manual tap      │                         │   • Function calling      │
│                     │                         │                           │
└────────┬────────────┘                        └───────────────────────────┘
         │                                              │
         │           No backend? No problem.            │
         └─────── Browser-side Gemini Live ◄───────────┘
```

### The Flow

1. **Setup** → Enter player names, pick 11 or 21 points, choose best-of format
2. **Wake Word** → Say *"SuperPong"* — the AI activates
3. **Smart Connection** → Frontend checks if the Vision Agents backend is live. If yes, full agent mode with WebRTC + YOLO ball tracking. If no, seamless fallback to browser-side Gemini Live — same features, no backend needed
4. **Live Vision** → Ball tracker runs YOLO on every frame, detects rallies, determines which side lost
5. **Auto Scoring** → Rally ends → tracker tells Gemini → Gemini calls `add_point()` → score updates
6. **Voice Commands** → Talk to SuperPong anytime: *"Point to Sarah"*, *"Undo"*, *"Pause"*
7. **Commentary** → Gemini delivers short, punchy commentary after each point
8. **Post-Match** → Summary screen with winner, stats, and point percentages

---

## 🛠️ Tech Stack

| Layer | Tech |
|:---|:---|
| **Frontend** | React 19 · TypeScript · Vite 6 · Tailwind CSS v4 |
| **Animations** | Motion (Framer Motion) |
| **AI (Browser)** | `@google/genai` — Gemini Live API |
| **AI (Backend)** | Vision Agents SDK — Gemini 2.5 Flash Realtime |
| **Video** | Stream Video WebRTC via `getstream.Edge()` |
| **Ball Tracking** | Ultralytics YOLO (custom `VideoProcessor`) |
| **Wake Word** | Web Speech API (zero-cost passive listening) |
| **Icons** | Lucide React |

---

## 📂 Project Structure

```
SuperPong/
├── src/
│   ├── App.tsx                    # Screen router → Setup / Match / PostMatch
│   ├── index.css                  # Tailwind v4 design tokens
│   ├── lib/
│   │   └── logger.ts              # Structured logging
│   ├── config/
│   │   └── runtime.ts             # Environment config
│   ├── store/
│   │   └── matchState.ts          # Match state + localStorage persistence
│   ├── components/
│   │   ├── SetupScreen.tsx        # Player config & match setup
│   │   ├── LiveHud.tsx            # Main game HUD — camera, scores, voice
│   │   └── PostMatch.tsx          # Results & statistics
│   └── hooks/
│       ├── useAgentConnection.ts  # Smart fallback: backend → browser Gemini
│       ├── useGeminiLive.ts       # Browser Gemini Live with auto-retry
│       └── useWakeWord.ts         # Passive "SuperPong" wake word detector
│
├── backend/
│   ├── agent.py                   # Vision Agents server + REST API
│   ├── .env.example               # Backend environment template
│   ├── umpire_instructions.md     # AI umpire system prompt
│   └── processors/
│       └── ball_tracker.py        # YOLO ball tracking processor
│
├── .env                           # Your API keys (not committed)
├── .env.example                   # Template for environment variables
├── package.json
└── vite.config.ts
```

---

## 🎯 What the AI Understands

SuperPong's AI operates under a strict umpire persona. Here's what it responds to:

| Category | Commands |
|:---|:---|
| **Scoring** | *"Point to [name]"* · *"Set score to 5-3"* · *"Undo that point"* |
| **Match Flow** | *"Pause"* · *"Resume"* · *"End the match"* |
| **Information** | *"What's the score?"* · *"Who's serving?"* |
| **Camera** | *"Zoom in"* · *"Show left side"* · *"Wide view"* |

And through **vision**, it automatically:
- Detects rally starts and ends
- Determines which side lost the point
- Awards the point to the correct player
- Triggers commentary
- Rotates serves per ITTF rules

---

## 🔑 Environment Variables

| Variable | Required | What it does |
|:---|:---:|:---|
| `VITE_GEMINI_API_KEY` | ✅ | Gemini API key for browser Gemini Live |
| `GEMINI_API_KEY` | ✅ | Same key, used by Vite build (auto-exposed) |
| `GOOGLE_API_KEY` | Backend | For the Python Vision Agents backend |
| `STREAM_API_KEY` | Backend | Stream Video WebRTC transport |
| `STREAM_API_SECRET` | Backend | Stream Video secret (also known as `STREAM_SECRET_KEY`) |
| `VITE_AGENT_URL` | No | Backend URL (default: `http://localhost:8000`) |

---

## ✅ Features

| Feature | Status |
|:---|:---:|
| Voice-commanded scoring | ✅ |
| Wake-word activation (*"SuperPong"*) | ✅ |
| YOLO ball tracking + auto-scoring | ✅ |
| Live voice commentary | ✅ |
| Manual tap-to-score fallback | ✅ |
| Full ITTF rules (deuce, serve rotation, sets) | ✅ |
| Auto-retry with exponential backoff | ✅ |
| Live connection status indicators | ✅ |
| Real elapsed match timer | ✅ |
| Post-match analytics | ✅ |
| Browser-only mode (no backend) | ✅ |
| Full Vision Agents + WebRTC mode | ✅ |
| Mobile landscape lock | ✅ |

---

## 🧑‍💻 Contributing

PRs welcome! If you have ideas for new features, better ball tracking, or UI improvements — open an issue or submit a PR.

---

<div align="center">

**Built with ❤️ for the [WeMakeDevs Vision Hackathon 2026](https://www.wemakedevs.org/hackathons/vision)**

*SuperPong — because every rally deserves an audience.*

</div>
