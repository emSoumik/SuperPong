/**
 * useWakeWord — Listens passively for the trigger phrase "SuperPong".
 *
 * Behaviour:
 * - Uses the browser's native SpeechRecognition API (no network cost, no Gemini usage).
 * - Runs in continuous/interim-free mode so it never interrupts normal game audio.
 * - The moment "superpong" appears in any recognised transcript, `onActivated` fires
 *   exactly once and the recognition engine shuts down permanently for the session.
 * - After activation the caller is expected to start the full Gemini Live session,
 *   which takes over the microphone at a much higher level.
 * - If the browser doesn't support SpeechRecognition the hook is a safe no-op.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

const WAKE_WORD = 'superpong';

interface UseWakeWordResult {
  /** True while the low-power recognition engine is running */
  isWatching: boolean;
  /** True once the wake word has been successfully detected */
  isActivated: boolean;
  /** Manually start listening (called by the component on mount) */
  start: () => void;
  /** Permanently deactivate — called once Gemini takes over */
  stop: () => void;
}

export function useWakeWord(onActivated: () => void): UseWakeWordResult {
  const [isWatching, setIsWatching] = useState(false);
  const [isActivated, setIsActivated] = useState(false);

  // Refs so callbacks never go stale
  const recognitionRef = useRef<any>(null);
  const activatedRef = useRef(false);
  const shouldRestartRef = useRef(false);

  const stop = useCallback(() => {
    shouldRestartRef.current = false;
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setIsWatching(false);
  }, []);

  const start = useCallback(() => {
    if (activatedRef.current) return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      console.warn('[useWakeWord] SpeechRecognition not supported in this browser.');
      return;
    }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      if (activatedRef.current) return;

      // Check all alternatives in all new results
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        for (let j = 0; j < result.length; j++) {
          const transcript = result[j].transcript.replace(/\s+/g, '').toLowerCase();
          if (transcript.includes(WAKE_WORD)) {
            activatedRef.current = true;
            setIsActivated(true);
            shouldRestartRef.current = false;
            recognition.abort();
            recognitionRef.current = null;
            setIsWatching(false);
            onActivated();
            return;
          }
        }
      }
    };

    recognition.onerror = (e: any) => {
      // Silently ignore 'no-speech' and 'aborted' — they're normal
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      console.warn('[useWakeWord] recognition error:', e.error);
    };

    recognition.onend = () => {
      setIsWatching(false);
      // Auto-restart unless deactivated — keeps listening indefinitely
      if (shouldRestartRef.current && !activatedRef.current) {
        setTimeout(() => {
          if (shouldRestartRef.current && !activatedRef.current) {
            try {
              recognition.start();
              setIsWatching(true);
            } catch (_) {}
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;

    try {
      recognition.start();
      setIsWatching(true);
    } catch (_) {}
  }, [onActivated]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      recognitionRef.current?.abort();
    };
  }, []);

  return { isWatching, isActivated, start, stop };
}
