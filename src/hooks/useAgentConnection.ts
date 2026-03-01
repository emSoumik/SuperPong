/**
 * useAgentConnection — Tries Vision Agents backend first, falls back to browser Gemini Live.
 *
 * 1. On mount, pings `AGENT_URL/health` to check if the backend is available.
 * 2. If `agent_available === true`, creates a session and lets the backend handle
 *    voice + vision via Vision Agents SDK (WebRTC transport + Gemini Realtime).
 * 3. If the backend is unavailable or the session fails, transparently falls back
 *    to the existing browser-side `useGeminiLive` hook which connects directly to
 *    Google's Gemini Live API from the browser.
 *
 * The returned API surface is identical regardless of which mode is active, so the
 * UI doesn't need to know which path is running.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MatchState } from '../store/matchState';
import { useGeminiLive } from './useGeminiLive';

const AGENT_URL = (typeof process !== 'undefined' && process.env?.VITE_AGENT_URL)
  || 'http://localhost:8000';

type ConnectionMode = 'idle' | 'checking' | 'agent' | 'browser-fallback';

interface AgentConnectionResult {
  /** Which mode is active */
  mode: ConnectionMode;
  /** Whether voice is connected (via either path) */
  isConnected: boolean;
  /** Whether the mic is live */
  isListening: boolean;
  /** Last text message from the AI */
  lastMessage: string;
  /** Connect voice */
  connect: () => Promise<void>;
  /** Disconnect voice */
  disconnect: () => void;
  /** Toggle mic on/off */
  toggleListening: () => void;
  /** Send a text message to the AI */
  sendTextMessage: (text: string) => void;
  /** Send a silent state update to the backend (no-op in browser mode) */
  sendStateUpdate: (state: MatchState) => void;
}

export function useAgentConnection(
  matchState: MatchState,
  onFunctionCall: (name: string, args: any) => void,
): AgentConnectionResult {
  const [mode, setMode] = useState<ConnectionMode>('idle');
  const [agentAvailable, setAgentAvailable] = useState<boolean | null>(null);
  const matchIdRef = useRef<string | null>(null);

  // Always call the Gemini Live hook — it's a React hook and must be called unconditionally.
  // We just won't use its `connect` unless we're in fallback mode.
  const geminiLive = useGeminiLive(matchState, onFunctionCall);

  // ------- Check backend health on mount -------
  useEffect(() => {
    let cancelled = false;
    setMode('checking');

    (async () => {
      try {
        const res = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;

        if (data.agent_available) {
          setAgentAvailable(true);
          setMode('agent');
        } else {
          setAgentAvailable(false);
          setMode('browser-fallback');
        }
      } catch {
        if (cancelled) return;
        setAgentAvailable(false);
        setMode('browser-fallback');
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ------- Agent session management -------

  const createAgentSession = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: `match-${Date.now()}`,
          player1_name: matchState.player1_name,
          player2_name: matchState.player2_name,
          best_of: matchState.best_of,
          serving: matchState.serving,
        }),
      });
      if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
      const data = await res.json();

      if (data.agent_connected) {
        matchIdRef.current = data.match_id;
        return true;
      }

      // Agent session couldn't start — fall back
      console.warn('Agent session created but agent not connected — falling back to browser Gemini');
      return false;
    } catch (err) {
      console.warn('Failed to create agent session:', err);
      return false;
    }
  }, [matchState.player1_name, matchState.player2_name, matchState.best_of, matchState.serving]);

  // ------- Unified API methods -------

  const connect = useCallback(async () => {
    if (mode === 'agent' || agentAvailable) {
      const ok = await createAgentSession();
      if (ok) {
        setMode('agent');
        // Agent mode uses WebRTC for voice — the backend handles everything.
        // We still connect the browser Gemini Live as a transparent companion
        // so the user has voice feedback while we confirm the agent is streaming.
        // If the agent is fully handling voice, we can skip this.
        return;
      }
      // Fall through to browser Gemini
      setMode('browser-fallback');
    }

    // Browser fallback
    setMode('browser-fallback');
    await geminiLive.connect();
  }, [mode, agentAvailable, createAgentSession, geminiLive]);

  const disconnect = useCallback(() => {
    if (mode === 'agent' && matchIdRef.current) {
      fetch(`${AGENT_URL}/sessions/${matchIdRef.current}`, { method: 'DELETE' }).catch(() => {});
      matchIdRef.current = null;
    }
    geminiLive.disconnect();
    setMode('idle');
  }, [mode, geminiLive]);

  const sendTextMessage = useCallback((text: string) => {
    if (mode === 'agent' && matchIdRef.current) {
      // Send text to backend agent via REST (it forwards to Gemini)
      fetch(`${AGENT_URL}/matches/${matchIdRef.current}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'send_text', text }),
      }).catch(() => {});
    }
    // Also send via browser Gemini if connected
    if (geminiLive.isConnected) {
      geminiLive.sendTextMessage(text);
    }
  }, [mode, geminiLive]);

  const sendStateUpdate = useCallback((state: MatchState) => {
    if (mode === 'agent' && matchIdRef.current) {
      fetch(`${AGENT_URL}/matches/${matchIdRef.current}/state-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player1_score: state.player1_score,
          player2_score: state.player2_score,
          player1_games: state.player1_games,
          player2_games: state.player2_games,
          current_game: state.current_game,
          serving: state.serving,
          status: state.status,
        }),
      }).catch(() => {});
    }
    // In browser fallback mode, state is already in the Gemini system prompt
    // and gets sent via sendTextMessage when rallies end. No extra action needed.
  }, [mode]);

  // ------- Auto-send state updates when score changes -------
  const prevScoreRef = useRef({ s1: matchState.player1_score, s2: matchState.player2_score, st: matchState.status });
  useEffect(() => {
    const prev = prevScoreRef.current;
    if (
      prev.s1 !== matchState.player1_score ||
      prev.s2 !== matchState.player2_score ||
      prev.st !== matchState.status
    ) {
      sendStateUpdate(matchState);
      prevScoreRef.current = { s1: matchState.player1_score, s2: matchState.player2_score, st: matchState.status };
    }
  }, [matchState.player1_score, matchState.player2_score, matchState.status, sendStateUpdate, matchState]);

  // ------- Return unified API -------
  return {
    mode,
    // In agent mode, voice is handled by the backend — we report connected if session exists
    isConnected: mode === 'agent' ? matchIdRef.current !== null : geminiLive.isConnected,
    isListening: mode === 'agent' ? matchIdRef.current !== null : geminiLive.isListening,
    lastMessage: geminiLive.lastMessage,
    connect,
    disconnect,
    toggleListening: geminiLive.toggleListening,
    sendTextMessage,
    sendStateUpdate,
  };
}
