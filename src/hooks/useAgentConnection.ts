import { useState, useEffect, useRef, useCallback } from 'react';
import { MatchState } from '../store/matchState';
import { useGeminiLive, GeminiStatus, ErrorHint } from './useGeminiLive';
import { runtimeConfig } from '../config/runtime';
import { logger } from '../lib/logger';

const AGENT_URL = runtimeConfig.agentUrl;

export type ConnectionMode = 'idle' | 'checking' | 'agent' | 'error';

interface AgentConnectionResult {
  mode: ConnectionMode;
  isConnected: boolean;
  isListening: boolean;
  lastMessage: string;
  /** Live status of the Gemini connection pipeline */
  geminiStatus: GeminiStatus;
  /** Suggested fix for any connection or backend errors */
  errorHint: ErrorHint | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleListening: () => void;
  sendTextMessage: (text: string) => void;
  sendStateUpdate: (state: MatchState) => void;
}

export function useAgentConnection(
  matchState: MatchState,
  onFunctionCall: (name: string, args: any) => void,
): AgentConnectionResult {
  const [mode, setMode] = useState<ConnectionMode>('idle');
  const [agentAvailable, setAgentAvailable] = useState<boolean | null>(null);
  const [agentErrorHint, setAgentErrorHint] = useState<ErrorHint | null>(null);
  const matchIdRef = useRef<string | null>(null);

  const {
    isConnected: isGeminiConnected,
    isListening: isGeminiListening,
    lastMessage,
    status: geminiStatus,
    errorHint: geminiErrorHint,
    connect: connectGemini,
    disconnect: disconnectGemini,
    toggleListening,
    sendTextMessage: sendTextToGemini,
    sendStateUpdate: sendStateToGemini,
  } = useGeminiLive(matchState, onFunctionCall);

  // Create a new recording/analysis session with the backend agent

  const createAgentSession = useCallback(async () => {
    try {
      const res = await fetch(`${AGENT_URL}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000),
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

      logger.info('Agent session created but agent not connected → browser fallback', {
        hook: 'useAgentConnection',
      });
      return false;
    } catch (err) {
      return false;
    }
  }, [matchState.player1_name, matchState.player2_name, matchState.best_of, matchState.serving]);

  // Primary connection logic: checks backend first, falls back to direct Gemini Live if needed

  const connect = useCallback(async () => {
    setMode('checking');
    setAgentErrorHint(null);
    let isAgentAvailable = agentAvailable;

    // Verify backend is reachable
    if (isAgentAvailable !== true) {
      try {
        logger.info('Checking backend health...', { url: `${AGENT_URL}/health`, hook: 'useAgentConnection' });
        const res = await fetch(`${AGENT_URL}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        isAgentAvailable = !!data.agent_available;
        setAgentAvailable(isAgentAvailable);
        if (isAgentAvailable) {
          setAgentErrorHint(null);
        }
      } catch {
        isAgentAvailable = false;
        setAgentAvailable(false);
        logger.info('Backend not reachable — using browser Gemini Live', { hook: 'useAgentConnection' });
      }
    }

    // Start an agent session if the backend is up
    if (isAgentAvailable) {
      const ok = await createAgentSession();
      if (ok) {
        setMode('agent');
        return;
      }
    }

    // Backend fallback is disabled for security (prevents exposing GEMINI_API_KEY in browser)
    setMode('error');
    setAgentErrorHint({
      title: 'Umpire Offline',
      hint: 'The AI scoring server is currently unavailable. Please ensure the backend is running and connected.',
    });
  }, [agentAvailable, createAgentSession]);

  // Attempt initial connection on load
  const didAutoConnect = useRef(false);
  useEffect(() => {
    if (!didAutoConnect.current) {
      didAutoConnect.current = true;
      connect().catch(err => {
        logger.error('Auto-connect failed', { hook: 'useAgentConnection', error: String(err) });
      });
    }
  }, [connect]);

  // Cleanup connections and sessions

  const disconnect = useCallback(() => {
    if (mode === 'agent' && matchIdRef.current) {
      fetch(`${AGENT_URL}/sessions/${matchIdRef.current}`, { method: 'DELETE' }).catch(() => { });
      matchIdRef.current = null;
    }
    disconnectGemini();
    setMode('idle');
  }, [mode, disconnectGemini]);

  // Send text to both agent (for training/logs) and direct Gemini

  const sendTextMessage = useCallback((text: string) => {
    if (mode === 'agent' && matchIdRef.current) {
      fetch(`${AGENT_URL}/matches/${matchIdRef.current}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'send_text', text }),
      }).catch(() => { });
    }
    if (isGeminiConnected) {
      sendTextToGemini(text);
    }
  }, [mode, isGeminiConnected, sendTextToGemini]);

  // Broadcast local match state (scores, server, etc.) to the AI

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
      }).catch(() => { });
    }
    sendStateToGemini(state);
  }, [mode, sendStateToGemini]);

  // Sync state whenever the score or match status changes

  const prevScoreRef = useRef({
    s1: matchState.player1_score,
    s2: matchState.player2_score,
    st: matchState.status,
  });

  useEffect(() => {
    const prev = prevScoreRef.current;
    if (
      prev.s1 !== matchState.player1_score ||
      prev.s2 !== matchState.player2_score ||
      prev.st !== matchState.status
    ) {
      sendStateUpdate(matchState);
      prevScoreRef.current = {
        s1: matchState.player1_score,
        s2: matchState.player2_score,
        st: matchState.status,
      };
    }
  }, [matchState.player1_score, matchState.player2_score, matchState.status, sendStateUpdate, matchState]);

  return {
    mode,
    isConnected: mode === 'agent' ? matchIdRef.current !== null : isGeminiConnected,
    isListening: mode === 'agent' ? matchIdRef.current !== null : isGeminiListening,
    lastMessage,
    geminiStatus,
    errorHint: agentErrorHint || geminiErrorHint,
    connect,
    disconnect,
    toggleListening,
    sendTextMessage,
    sendStateUpdate,
  };
}
