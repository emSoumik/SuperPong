"""
SpikeSense — Vision Agents Backend
===================================

Runs a Gemini Realtime agent with WebRTC transport (via Stream Video)
and YOLO ball tracking. Exposes a REST API for session management,
state sync, and a ``/health`` endpoint that tells the frontend whether
the Vision Agents SDK is available.

If the SDK is NOT installed the server still boots in *fallback mode*:
a plain FastAPI server with the same REST endpoints but no AI.  The
frontend then knows to use its own browser-side Gemini Live connection.

Usage (with uv):
    uv run agent.py serve --host 0.0.0.0 --port 8000

Usage (plain python):
    python agent.py serve --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import pathlib
import sys
import time
from typing import Any

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spikesense.agent")

# Check for Vision Agents SDK availability

HAS_VISION_SDK = False
try:
    from vision_agents.core import Agent, AgentLauncher, Runner, User  # noqa: F401
    from vision_agents.plugins import gemini, getstream  # noqa: F401

    HAS_VISION_SDK = True
    logger.info("✓ Vision Agents SDK detected — full agent mode")
except ImportError:
    logger.warning(
        "✗ Vision Agents SDK not installed — running in fallback/REST-only mode. "
        "Frontend will use browser-side Gemini Live."
    )

# Always import FastAPI for REST
try:
    from fastapi import FastAPI, responses
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    FileResponse = responses.FileResponse
except ImportError:
    print("ERROR: fastapi + uvicorn are required.  pip install fastapi uvicorn[standard]")
    sys.exit(1)

from processors.ball_tracker import BallTrackingProcessor

# Authorization-authoritative in-memory match state

UMPIRE_INSTRUCTIONS_PATH = pathlib.Path(__file__).parent / "umpire_instructions.md"

active_agents: dict[str, Any] = {}
match_states: dict[str, dict[str, Any]] = {}
_last_state_hash: dict[str, str] = {}
_active_match_id: str | None = None


def _default_state() -> dict[str, Any]:
    return {
        "player1_name": "Player 1",
        "player2_name": "Player 2",
        "player1_score": 0,
        "player2_score": 0,
        "player1_games": 0,
        "player2_games": 0,
        "current_game": 1,
        "serving": "player1",
        "best_of": 3,
        "status": "idle",
        "events": [],
    }


def _get_state(match_id: str) -> dict[str, Any]:
    if match_id not in match_states:
        match_states[match_id] = _default_state()
    return match_states[match_id]


# State synchronization with the agent


async def _push_state_to_agent(match_id: str) -> None:
    """Silently send the current match state to the active Gemini agent.

    This ensures the AI always knows the real score even when the user
    changes it with manual UI buttons.
    """
    agent = active_agents.get(match_id)
    if agent is None:
        return
    state = _get_state(match_id)
    state_str = (
        f"[SYSTEM STATE UPDATE] "
        f"Score: {state['player1_name']} {state['player1_score']} - "
        f"{state['player2_score']} {state['player2_name']}. "
        f"Games: {state['player1_games']}-{state['player2_games']}. "
        f"Game {state['current_game']}. "
        f"Status: {state['status']}. "
        f"Serving: {state['serving']}."
    )
    state_hash = str(hash(state_str))
    if _last_state_hash.get(match_id) == state_hash:
        return
    _last_state_hash[match_id] = state_hash
    try:
        if hasattr(agent, "send_text"):
            await agent.send_text(state_str)
        logger.debug("Pushed state to agent for match %s", match_id)
    except Exception as exc:
        logger.debug("State push failed: %s", exc)


# Agent lifecycle and tool registration


async def create_agent(call_id: str | None = None, **kwargs: Any) -> Agent | None:
    if not HAS_VISION_SDK:
        return None

    global _active_match_id

    instructions_raw = UMPIRE_INSTRUCTIONS_PATH.read_text()
    custom_rules = kwargs.pop("custom_rules", "")
    instructions = instructions_raw.replace("{custom_rules}", custom_rules)

    match_id = kwargs.get("match_id", call_id or "default")
    _active_match_id = match_id
    state = _get_state(match_id)

    # Apply initial config from kwargs
    for key in ("player1_name", "player2_name", "best_of", "serving"):
        if key in kwargs:
            state[key] = kwargs[key]

    llm = gemini.Realtime(fps=5, model="gemini-2.5-flash")

    # Ball tracking with event triggers
    ball_tracker = BallTrackingProcessor(
        event_callback=lambda evt: _on_tracker_event(match_id, evt),
    )

    # Tool definitions for the AI to act on the game

    @llm.register_function(description="Award point(s) to a player. player_id is 'player1' or 'player2'. count is the number of points to add, defaults to 1.")
    async def add_point(player_id: str, count: int = 1) -> str:
        s = _get_state(match_id)
        key = f"{player_id}_score"
        if key not in s:
            return json.dumps({"error": f"Unknown player: {player_id}"})
        s[key] += count
        _check_game_win(s, player_id)
        asyncio.create_task(_push_state_to_agent(match_id))
        return json.dumps({
            "player": s.get(f"{player_id}_name", player_id),
            "score": f"{s['player1_score']}-{s['player2_score']}",
            "games": f"{s['player1_games']}-{s['player2_games']}",
            "action": f"added {count} point(s)"
        })

    @llm.register_function(description="Undo the last point scored.")
    async def undo_last_point() -> str:
        s = _get_state(match_id)
        if s["events"]:
            last = s["events"].pop()
            pid = last.get("player_id")
            if pid:
                key = f"{pid}_score"
                s[key] = max(0, s[key] - 1)
        asyncio.create_task(_push_state_to_agent(match_id))
        return json.dumps({"score": f"{s['player1_score']}-{s['player2_score']}", "undone": True})

    @llm.register_function(description="Get the current score and match status.")
    async def get_current_score() -> str:
        s = _get_state(match_id)
        return json.dumps({
            "score": f"{s['player1_name']} {s['player1_score']} - {s['player2_score']} {s['player2_name']}",
            "games": f"{s['player1_games']}-{s['player2_games']}",
            "game": s["current_game"],
            "serving": s["serving"],
            "status": s["status"],
        })

    @llm.register_function(description="Pause the match.")
    async def pause_match() -> str:
        s = _get_state(match_id)
        s["status"] = "paused"
        asyncio.create_task(_push_state_to_agent(match_id))
        return json.dumps({"status": "paused"})

    @llm.register_function(description="Resume or start the match.")
    async def resume_match() -> str:
        s = _get_state(match_id)
        s["status"] = "active"
        asyncio.create_task(_push_state_to_agent(match_id))
        return json.dumps({"status": "active"})

    @llm.register_function(description="End the match.")
    async def end_match() -> str:
        s = _get_state(match_id)
        s["status"] = "ended"
        asyncio.create_task(_push_state_to_agent(match_id))
        return json.dumps({"status": "ended"})

    @llm.register_function(description="Override the score directly. player1_score and player2_score are integers.")
    async def override_score(player1_score: int, player2_score: int) -> str:
        s = _get_state(match_id)
        s["player1_score"] = player1_score
        s["player2_score"] = player2_score
        asyncio.create_task(_push_state_to_agent(match_id))
        return json.dumps({"score": f"{player1_score}-{player2_score}"})

    @llm.register_function(description="Set serving player. slot is 'player1' or 'player2'.")
    async def set_serving(slot: str) -> str:
        s = _get_state(match_id)
        if slot in ("player1", "player2"):
            s["serving"] = slot
        asyncio.create_task(_push_state_to_agent(match_id))
        return json.dumps({"serving": slot})

    agent = Agent(
        edge=getstream.Edge(),
        agent_user=User(name="SpikeSense", id="spikesense-agent"),
        instructions=instructions,
        llm=llm,
        processors=[ball_tracker],
    )

    active_agents[match_id] = agent
    return agent


# Handles vision-based events from the tracker


async def _on_tracker_event(match_id: str, event: dict[str, Any]) -> None:
    agent = active_agents.get(match_id)
    if agent is None:
        return
    state = _get_state(match_id)
    if state.get("status") != "active":
        return  # only process events during active match

    etype = event.get("type")
    if etype == "POINT_SCORED":
        winner_side = event.get("winner_side", "unknown")
        msg = f"[VISION EVENT] POINT_SCORED — winner_side={winner_side}, rally_length={event.get('rally_length', 0)}"
        try:
            if hasattr(agent, "send_text"):
                await agent.send_text(msg)
        except Exception:
            pass
    elif etype == "RALLY_END":
        loser_side = event.get("loser_side", "unknown")
        msg = f"[VISION EVENT] RALLY_END — loser_side={loser_side}, rally_length={event.get('rally_length', 0)}, duration={event.get('duration', 0)}s"
        try:
            if hasattr(agent, "send_text"):
                await agent.send_text(msg)
        except Exception:
            pass


# Score and match logic


def _check_game_win(state: dict[str, Any], scorer: str) -> None:
    s1, s2 = state["player1_score"], state["player2_score"]
    goal = 11
    if s1 >= goal and s1 - s2 >= 2:
        state["player1_games"] += 1
        state["player1_score"] = 0
        state["player2_score"] = 0
        state["current_game"] += 1
        _add_event(state, "GAME_WON", "player1")
        _check_match_win(state)
    elif s2 >= goal and s2 - s1 >= 2:
        state["player2_games"] += 1
        state["player1_score"] = 0
        state["player2_score"] = 0
        state["current_game"] += 1
        _add_event(state, "GAME_WON", "player2")
        _check_match_win(state)

    # Serve rotation
    total = s1 + s2
    if total >= 20:
        state["serving"] = "player1" if total % 2 == 0 else "player2"
    else:
        state["serving"] = "player1" if (total // 2) % 2 == 0 else "player2"


def _check_match_win(state: dict[str, Any]) -> None:
    needed = (state["best_of"] // 2) + 1
    if state["player1_games"] >= needed:
        state["status"] = "ended"
        _add_event(state, "MATCH_WON", "player1")
    elif state["player2_games"] >= needed:
        state["status"] = "ended"
        _add_event(state, "MATCH_WON", "player2")


def _add_event(state: dict[str, Any], etype: str, player_id: str | None = None) -> None:
    state["events"].append({
        "type": etype,
        "player_id": player_id,
        "timestamp": time.time(),
    })


# API endpoints for session and state management


def create_app() -> FastAPI:
    app = FastAPI(title="SpikeSense Agent", version="0.1.0")
    cors_origins_raw = os.getenv("CORS_ORIGINS", "*")
    cors_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]
    allow_all_origins = "*" in cors_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if allow_all_origins else cors_origins,
        allow_credentials=not allow_all_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    favicon_path = pathlib.Path(__file__).parent / "favicon.ico"

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        if favicon_path.exists():
            return FileResponse(favicon_path)
        return responses.Response(status_code=404)

    # Health and capability check for the frontend
    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "agent_available": HAS_VISION_SDK,
            "fallback": "browser-gemini-live" if not HAS_VISION_SDK else None,
            "active_matches": list(match_states.keys()),
        }

    # Session management
    @app.post("/sessions")
    async def create_session(body: dict[str, Any] = {}):
        match_id = body.get("match_id", f"match-{int(time.time())}")
        state = _get_state(match_id)
        for key in ("player1_name", "player2_name", "best_of", "serving", "custom_rules"):
            if key in body:
                state[key] = body[key]

        agent = None
        if HAS_VISION_SDK:
            try:
                agent = await create_agent(
                    match_id=match_id,
                    player1_name=state["player1_name"],
                    player2_name=state["player2_name"],
                    best_of=state.get("best_of", 3),
                    custom_rules=body.get("custom_rules", ""),
                )
            except Exception as exc:
                logger.error("Failed to create Vision Agent: %s", exc)
                agent = None

        return {
            "match_id": match_id,
            "agent_connected": agent is not None,
            "fallback": agent is None,
            "state": state,
        }

    @app.delete("/sessions/{match_id}")
    async def delete_session(match_id: str):
        agent = active_agents.pop(match_id, None)
        if agent is not None:
            try:
                await agent.close()
            except Exception:
                pass
        match_states.pop(match_id, None)
        _last_state_hash.pop(match_id, None)
        return {"deleted": True}

    # Match state access
    @app.get("/matches/{match_id}")
    async def get_match(match_id: str):
        return _get_state(match_id)

    @app.post("/matches/{match_id}/command")
    async def apply_command(match_id: str, body: dict[str, Any] = {}):
        command = body.get("command", "")
        state = _get_state(match_id)

        if command == "add_point":
            pid = body.get("player_id", "player1")
            key = f"{pid}_score"
            if key in state:
                state[key] += 1
                _check_game_win(state, pid)
                _add_event(state, "POINT_SCORED", pid)
        elif command == "undo":
            if state["events"]:
                last = state["events"].pop()
                pid = last.get("player_id")
                if pid and last.get("type") == "POINT_SCORED":
                    key = f"{pid}_score"
                    state[key] = max(0, state[key] - 1)
        elif command == "pause":
            state["status"] = "paused"
        elif command == "resume":
            state["status"] = "active"
        elif command == "end":
            state["status"] = "ended"
        elif command == "set_serving":
            slot = body.get("slot", "player1")
            if slot in ("player1", "player2"):
                state["serving"] = slot
        elif command == "override_score":
            state["player1_score"] = body.get("player1_score", state["player1_score"])
            state["player2_score"] = body.get("player2_score", state["player2_score"])

        asyncio.create_task(_push_state_to_agent(match_id))
        return state

    # Manual state overrides from frontend
    @app.post("/matches/{match_id}/state-notify")
    async def state_notify(match_id: str, body: dict[str, Any] = {}):
        """Frontend notifies backend of manual state changes."""
        state = _get_state(match_id)
        for key in ("player1_score", "player2_score", "player1_games", "player2_games",
                     "current_game", "serving", "status"):
            if key in body:
                state[key] = body[key]
        asyncio.create_task(_push_state_to_agent(match_id))
        return {"ok": True}

    return app


# Server entry point


def main():
    """Run the agent server."""
    app = create_app()

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    if HAS_VISION_SDK:
        # Vision Agents SDK runner wraps FastAPI + WebRTC
        try:
            async def _join_call(call_id: str, **kwargs):
                agent = await create_agent(call_id=call_id, **kwargs)
                return agent

            launcher = AgentLauncher(
                create_agent=create_agent,
                join_call=_join_call,
            )
            runner = Runner(launcher)

            # If CLI args present, use SDK's CLI (serve, etc.)
            if len(sys.argv) > 1:
                runner.cli()
                return
        except Exception as exc:
            logger.error("Vision Agents Runner failed: %s — falling back to plain uvicorn", exc)

    # Plain uvicorn fallback
    logger.info("Starting SpikeSense server on %s:%s (fallback=%s)", host, port, not HAS_VISION_SDK)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
