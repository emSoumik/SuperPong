import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Session, Type } from '@google/genai';
import { MatchState } from '../store/matchState';
import { runtimeConfig } from '../config/runtime';
import { logger } from '../lib/logger';

const tools = [{
  functionDeclarations: [
    {
      name: 'add_point',
      description: 'Add point(s) to a player.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          player: { type: Type.STRING, enum: ['player1', 'player2'] },
          count: { type: Type.NUMBER, description: 'Number of points to add. Defaults to 1.' },
        },
        required: ['player'],
      },
    },
    { name: 'pause_match', description: 'Pause the current match.' },
    { name: 'resume_match', description: 'Start or resume the current match.' },
    { name: 'end_match', description: 'End the current match.' },
    { name: 'get_score', description: 'Read the current score aloud.' },
    {
      name: 'override_score',
      description: 'Set both scores manually.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          score1: { type: Type.NUMBER },
          score2: { type: Type.NUMBER },
        },
        required: ['score1', 'score2'],
      },
    },
    {
      name: 'set_camera_view',
      description: 'Set camera view to center, left, right, or wide.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          view: { type: Type.STRING, enum: ['center', 'left', 'right', 'wide'] },
        },
        required: ['view'],
      },
    },
    {
      name: 'set_serving',
      description: 'Set which player is currently serving.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          player: { type: Type.STRING, enum: ['player1', 'player2'] },
        },
        required: ['player'],
      },
    },
    {
      name: 'add_game_win',
      description: 'Add a game win to a player.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          player: { type: Type.STRING, enum: ['player1', 'player2'] },
        },
        required: ['player'],
      },
    },
  ],
}];

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const float32ToPcm16Base64 = (inputData: Float32Array): string => {
  const pcm16 = new Int16Array(inputData.length);
  for (let i = 0; i < inputData.length; i++) {
    const sample = Math.max(-1, Math.min(1, inputData[i]));
    pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const buffer = new ArrayBuffer(pcm16.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcm16.length; i++) {
    view.setInt16(i * 2, pcm16[i], true);
  }
  return bytesToBase64(new Uint8Array(buffer));
};

const decodePcm16ToFloat32 = (base64Data: string): Float32Array => {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const pcm16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    float32[i] = pcm16[i] / 32768.0;
  }
  return float32;
};

const buildSystemInstruction = (state: MatchState): string => {
  const prefixes = runtimeConfig.wakeWord.commandPrefixes.join(', ');

  return `You are SuperPong, an autonomous table-tennis umpire and commentator.

Execution rules:
1) You are a live commentator and umpire. Provide immediate verbal updates and commentary whenever the match state changes or a point is scored.
2) No wake word or prefix is required. Respond to match events and player commands naturally and instantly.
3) On scoring events, call the 'add_point' tool first (you can pass a 'count' parameter if asked to add multiple points), then announce the new score and provide brief commentary. If asked to 'set' the score exactly, use the 'override_score' tool.
4) Match Flow Authority: You have full authority to start, pause, resume, and end the match.
   - When the match status is 'idle' or during a countdown, use this time to verify your audio/video and greet the players enthusiastically! (e.g. "Welcome to the SuperPong final!").
   - When the match transitions to 'active', announce the start immediately.
   - Use the 'end_match' tool when the game format is complete, and announce the final results and winner.
5) [SYSTEM STATE UPDATE] messages are your cue for live updates. If the state shows a score change or status update, announce it clearly.
6) Maintain an engaging, professional sports-broadcaster persona. Keep commentary concise (max 2 sentences) to maintain game flow.

Current state:
- Players: ${state.player1_name} vs ${state.player2_name}
- Score: ${state.player1_name} ${state.player1_score} - ${state.player2_score} ${state.player2_name}
- Games: ${state.player1_games}-${state.player2_games}
- Current game: ${state.current_game}
- Serving: ${state.serving}
- Status: ${state.status}
- Format: first to ${state.points_to_win ?? 11}, best of ${state.best_of}.`;
};

export type GeminiStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'reconnecting';

export interface ErrorHint {
  title: string;
  hint: string;
}

const getHintForError = (err: any): ErrorHint | null => {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

  if (msg.includes('createMediaStreamSource') || msg.includes('getusermedia') || msg.includes('permission')) {
    return { title: 'Microphone Blocked', hint: 'Please grant microphone access in your browser settings.' };
  }
  if (msg.includes('api key') || msg.includes('403') || msg.includes('401')) {
    return { title: 'API Key Issue', hint: 'Check your VITE_GEMINI_API_KEY in the .env file.' };
  }
  if (msg.includes('model not found') || msg.includes('404')) {
    return { title: 'Model Unavailable', hint: 'Ensure the Gemini Live model ID is correct in runtime.ts.' };
  }
  if (msg.includes('quota') || msg.includes('limit') || msg.includes('429')) {
    return { title: 'Rate Limited', hint: 'You have reached your API quota. Please try again later.' };
  }

  return { title: 'Connection Error', hint: 'Something went wrong. Check the console for details.' };
};

export function useGeminiLive(
  matchState: MatchState,
  onFunctionCall: (name: string, args: any) => void,
) {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [lastMessage, setLastMessage] = useState<string>('');
  const [status, setStatus] = useState<GeminiStatus>('idle');
  const [errorHint, setErrorHint] = useState<ErrorHint | null>(null);

  const isListeningRef = useRef(false);
  // sessionRef holds the resolved Session (not a Promise)
  const sessionRef = useRef<Session | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const isConnectingRef = useRef(false);
  const retryCountRef = useRef(0);

  // Keep latest refs for callbacks that fire across renders
  const matchStateRef = useRef(matchState);
  matchStateRef.current = matchState;
  const onFunctionCallRef = useRef(onFunctionCall);
  onFunctionCallRef.current = onFunctionCall;


  const playAudioChunk = useCallback((float32Data: Float32Array) => {
    if (!audioContextRef.current) return;
    const ctx = audioContextRef.current;

    const buffer = ctx.createBuffer(1, float32Data.length, runtimeConfig.audio.outputSampleRate);
    buffer.copyToChannel(float32Data, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now;
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;
  }, []);


  const cleanupAudio = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => { });
      audioContextRef.current = null;
    }
  }, []);


  const connect = useCallback(async () => {
    if (sessionRef.current || isConnectingRef.current) return;
    isConnectingRef.current = true;
    setStatus('connecting');
    setErrorHint(null);

    try {
      const apiKey = runtimeConfig.geminiApiKey;
      if (!apiKey) {
        throw new Error('GEMINI API key not found — set VITE_GEMINI_API_KEY in .env');
      }

      const ai = new GoogleGenAI({ apiKey });

      // Create/Resume AudioContext for playback + mic capture
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: runtimeConfig.audio.inputSampleRate,
        });
      }

      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const audioContext = audioContextRef.current;

      // Setup microphone capture
      // We wire it up first so audio flows the instant the session opens.
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = micStream;
        const micSource = audioContext.createMediaStreamSource(micStream);
        const processor = audioContext.createScriptProcessor(
          runtimeConfig.audio.processorBufferSize, 1, 1,
        );
        processorRef.current = processor;

        processor.onaudioprocess = (event) => {
          if (!isListeningRef.current) return;
          const session = sessionRef.current;
          if (!session) return;

          const base64 = float32ToPcm16Base64(event.inputBuffer.getChannelData(0));

          // Official API: use { audio: { data, mimeType } }
          session.sendRealtimeInput({
            audio: {
              data: base64,
              mimeType: `audio/pcm;rate=${runtimeConfig.audio.inputSampleRate}`,
            },
          });
        };

        micSource.connect(processor);
        processor.connect(audioContext.destination);
      } catch (micErr) {
        const hint = getHintForError(micErr);
        setErrorHint(hint);
        logger.warn('Microphone capture failed — voice input disabled, AI still responds to text', {
          hook: 'useGeminiLive',
          error: micErr instanceof Error ? micErr.message : String(micErr),
        });
      }

      // Establish WebSocket connection to Gemini Live
      // In @google/genai ≥1.x, connect() awaits the WebSocket onopen
      // before returning the Session. We must NOT reference the return
      // value inside onopen (it hasn't resolved yet).

      const session = await ai.live.connect({
        model: runtimeConfig.geminiModel,
        callbacks: {
          onopen: () => {
            // Fires before connect() resolves — sessionRef isn't set yet
            setIsConnected(true);
            setIsListening(true);
            setStatus('connected');
            isListeningRef.current = true;
            retryCountRef.current = 0;
            logger.info('Gemini Live session opened', { hook: 'useGeminiLive' });
          },
          onmessage: (message: LiveServerMessage) => {
            // Audio + text from model
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  playAudioChunk(decodePcm16ToFloat32(part.inlineData.data));
                }
                if (part.text) {
                  setLastMessage(part.text);
                }
              }
            }

            // Handle interruption — flush audio queue
            if (message.serverContent?.interrupted) {
              nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
            }

            // Function calls
            if (!message.toolCall?.functionCalls) return;

            const responses: Array<{ id: string; name: string; response: Record<string, unknown> }> = [];
            for (const call of message.toolCall.functionCalls) {
              try {
                onFunctionCallRef.current(call.name, call.args);
                responses.push({ id: call.id, name: call.name, response: { result: 'success' } });
              } catch (err: any) {
                responses.push({ id: call.id, name: call.name, response: { error: err?.message || 'Tool error' } });
              }
            }

            if (sessionRef.current) {
              sessionRef.current.sendToolResponse({ functionResponses: responses });
            }
          },
          onclose: () => {
            logger.info('Gemini Live session closed', { hook: 'useGeminiLive' });
            setIsConnected(false);
            setIsListening(false);
            isListeningRef.current = false;
            sessionRef.current = null;
            setStatus('idle');
          },
          onerror: (err) => {
            setErrorHint(getHintForError(err));
            logger.error('Gemini Live session error', {
              hook: 'useGeminiLive',
              error: err instanceof Error ? err.message : String(err),
            });
            setStatus('error');
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: buildSystemInstruction(matchStateRef.current),
          tools,
        },
      });

      // Session resolved — make it available to the audio processor
      sessionRef.current = session;
      isConnectingRef.current = false;

    } catch (err) {
      isConnectingRef.current = false;
      setStatus('error');
      cleanupAudio();

      setErrorHint(getHintForError(err));
      logger.error('Failed to connect Gemini Live', {
        hook: 'useGeminiLive',
        error: err instanceof Error ? err.message : String(err),
        retryCount: retryCountRef.current,
      });

      // Auto-retry up to 3 times with exponential backoff
      if (retryCountRef.current < 3) {
        retryCountRef.current++;
        const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 4000);
        setStatus('reconnecting');
        logger.info(`Retrying Gemini Live connection in ${delay}ms (attempt ${retryCountRef.current}/3)`, {
          hook: 'useGeminiLive',
        });
        setTimeout(() => {
          isConnectingRef.current = false;
          connect();
        }, delay);
      }
    }
  }, [playAudioChunk, cleanupAudio]);


  const disconnect = useCallback(() => {
    isConnectingRef.current = false;
    retryCountRef.current = 99; // prevent auto-retry during intentional disconnect
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    cleanupAudio();
    setIsConnected(false);
    setIsListening(false);
    isListeningRef.current = false;
    setStatus('idle');
  }, [cleanupAudio]);


  const toggleListening = useCallback(() => {
    setIsListening(prev => {
      const next = !prev;
      isListeningRef.current = next;
      return next;
    });
  }, []);


  const sendTextMessage = useCallback((text: string) => {
    if (!sessionRef.current) return;
    sessionRef.current.sendRealtimeInput([{ text }]);
  }, []);


  const sendStateUpdate = useCallback((state: MatchState) => {
    if (!sessionRef.current) return;

    const message =
      `[SYSTEM STATE UPDATE] Score: ${state.player1_name} ${state.player1_score} - ` +
      `${state.player2_score} ${state.player2_name}. Games: ${state.player1_games}-${state.player2_games}. ` +
      `Game ${state.current_game}. Status: ${state.status}. Serving: ${state.serving}. ` +
      `This is a silent context update; do not respond aloud.`;

    sessionRef.current.sendRealtimeInput([{ text: message }]);
  }, []);


  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  return {
    isConnected,
    isListening,
    lastMessage,
    status,
    errorHint,
    connect,
    disconnect,
    toggleListening,
    sendTextMessage,
    sendStateUpdate,
  };
}
