import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from "@google/genai";
import { MatchState } from '../store/matchState';

const tools = [{
  functionDeclarations: [
    {
      name: "add_point",
      description: "Add a point to a player",
      parameters: {
        type: Type.OBJECT,
        properties: {
          player: { type: Type.STRING, enum: ["player1", "player2"] }
        },
        required: ["player"]
      }
    },
    { name: "pause_match", description: "Pause the current match or take a break" },
    { name: "resume_match", description: "Resume the match" },
    { name: "get_score", description: "Read the current score aloud" },
    { name: "override_score",
      description: "Set both scores manually",
      parameters: {
        type: Type.OBJECT,
        properties: {
          score1: { type: Type.NUMBER },
          score2: { type: Type.NUMBER }
        },
        required: ["score1", "score2"]
      }
    },
    {
      name: "set_camera_view",
      description: "Move the camera view to center, left, right, or wide",
      parameters: {
        type: Type.OBJECT,
        properties: {
          view: { type: Type.STRING, enum: ["center", "left", "right", "wide"] }
        },
        required: ["view"]
      }
    },
    {
      name: "set_serving",
      description: "Set which player is currently serving",
      parameters: {
        type: Type.OBJECT,
        properties: {
          player: { type: Type.STRING, enum: ["player1", "player2"] }
        },
        required: ["player"]
      }
    },
    {
      name: "add_game_win",
      description: "Add a game (set) win to a player",
      parameters: {
        type: Type.OBJECT,
        properties: {
          player: { type: Type.STRING, enum: ["player1", "player2"] }
        },
        required: ["player"]
      }
    }
  ]
}];

export function useGeminiLive(
  matchState: MatchState,
  onFunctionCall: (name: string, args: any) => void
) {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [lastMessage, setLastMessage] = useState<string>('');
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const playbackQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);

  const connect = useCallback(async () => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key not found");

      const ai = new GoogleGenAI({ apiKey });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        callbacks: {
          onopen: async () => {
            setIsConnected(true);
            setIsListening(true);
            isListeningRef.current = true;
            
            // Start microphone
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              streamRef.current = stream;
              const source = audioContextRef.current!.createMediaStreamSource(stream);
              const processor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
              processorRef.current = processor;
              
              processor.onaudioprocess = (e) => {
                if (!isListeningRef.current) return;
                const inputData = e.inputBuffer.getChannelData(0);
                // Convert Float32 to Int16
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  let s = Math.max(-1, Math.min(1, inputData[i]));
                  pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                // Convert to base64
                const buffer = new ArrayBuffer(pcm16.length * 2);
                const view = new DataView(buffer);
                for (let i = 0; i < pcm16.length; i++) {
                  view.setInt16(i * 2, pcm16[i], true); // little endian
                }
                
                const base64Data = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                
                sessionPromise.then(session => {
                  session.sendRealtimeInput({
                    media: {
                      mimeType: 'audio/pcm;rate=16000',
                      data: base64Data
                    }
                  });
                });
              };
              
              source.connect(processor);
              processor.connect(audioContextRef.current!.destination);
            } catch (err) {
              console.error("Mic error:", err);
            }
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData && part.inlineData.data) {
                  // Decode base64 audio
                  const binaryString = atob(part.inlineData.data);
                  const bytes = new Uint8Array(binaryString.length);
                  for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                  }
                  
                  // Convert Int16 to Float32
                  const pcm16 = new Int16Array(bytes.buffer);
                  const float32 = new Float32Array(pcm16.length);
                  for (let i = 0; i < pcm16.length; i++) {
                    float32[i] = pcm16[i] / 32768.0;
                  }
                  
                  playAudioChunk(float32);
                }
                if (part.text) {
                  setLastMessage(part.text);
                }
              }
            }
            
            if (message.serverContent?.interrupted) {
              playbackQueueRef.current = [];
              nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
            }
            
            if (message.toolCall) {
              const functionCalls = message.toolCall.functionCalls;
              if (functionCalls) {
                const responses = [];
                for (const call of functionCalls) {
                  try {
                    onFunctionCall(call.name, call.args);
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { result: "success" }
                    });
                  } catch (err: any) {
                    responses.push({
                      id: call.id,
                      name: call.name,
                      response: { error: err.message }
                    });
                  }
                }
                
                sessionPromise.then(session => {
                  session.sendToolResponse({ functionResponses: responses });
                });
              }
            }
          },
          onclose: () => {
            setIsConnected(false);
            setIsListening(false);
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: `You are SuperPong, an energetic and professional AI table tennis commentator and referee.
          
          CRITICAL INSTRUCTIONS:
          1. Your name is SuperPong. You are only activated by the wake word "SuperPong".
          2. You are actively watching a live table tennis match between real players.
          3. IMPORTANT: Do NOT interject during normal conversation between players, spectators, or bystanders. Only respond when:
             a) You receive a [SYSTEM] message indicating a rally ended or a point was scored — immediately call 'add_point'.
             b) Someone directly addresses you starting with "SuperPong".
             c) You detect an unambiguous scoring event from the video/audio feed.
          4. When a point is detected, call 'add_point' first, THEN give brief enthusiastic commentary (max 2 sentences).
          5. Treat all background conversation, cheering, or table noise as irrelevant unless it is a direct command to you.
          6. You can also handle score overrides, pause/resume, and camera view changes when directly asked.
          
          Current players: ${matchState.player1_name} vs ${matchState.player2_name}.
          Current score: ${matchState.player1_name} ${matchState.player1_score} - ${matchState.player2_score} ${matchState.player2_name}.
          Playing to: ${matchState.points_to_win ?? 11} points. Best of ${matchState.best_of} sets.`,
          tools: tools,
        }
      });
      
      sessionRef.current = await sessionPromise;
      
    } catch (err) {
      console.error("Failed to connect:", err);
    }
  }, [matchState, onFunctionCall]);

  const playAudioChunk = useCallback((float32Data: Float32Array) => {
    if (!audioContextRef.current) return;
    
    const buffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000); // Output is 24kHz
    buffer.copyToChannel(float32Data, 0);
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    
    const currentTime = audioContextRef.current.currentTime;
    if (nextPlayTimeRef.current < currentTime) {
      nextPlayTimeRef.current = currentTime;
    }
    
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;
  }, []);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsConnected(false);
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    setIsListening(prev => {
      const next = !prev;
      isListeningRef.current = next;
      return next;
    });
  }, []);



  const sendTextMessage = useCallback((text: string) => {
    if (sessionRef.current) {
      sessionRef.current.sendRealtimeInput([{ text }]);
    }
  }, []);

  /**
   * Send a silent system state update to the live session.
   * This ensures the AI always knows the current score, even when the user
   * manually changes it via the UI buttons.
   */
  const sendStateUpdate = useCallback((state: MatchState) => {
    if (!sessionRef.current) return;
    const msg =
      `[SYSTEM STATE UPDATE] ` +
      `Score: ${state.player1_name} ${state.player1_score} - ${state.player2_score} ${state.player2_name}. ` +
      `Games: ${state.player1_games}-${state.player2_games}. ` +
      `Game ${state.current_game}. ` +
      `Status: ${state.status}. ` +
      `Serving: ${state.serving}.`;
    sessionRef.current.sendRealtimeInput([{ text: msg }]);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    isListening,
    lastMessage,
    connect,
    disconnect,
    toggleListening,
    sendTextMessage,
    sendStateUpdate,
  };
}
