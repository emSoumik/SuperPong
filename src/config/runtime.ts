const trimTrailingSlash = (value: string) => value.replace(/\/$/,  '');

export const runtimeConfig = {
  // VITE_AGENT_URL should be set in your deployment environment.
  // Production: https://superpong-backend.onrender.com
  // Dev preview: https://superpong-backend-rwdf.onrender.com
  // Local:       http://localhost:8080
  agentUrl: trimTrailingSlash(import.meta.env.VITE_AGENT_URL || 'https://superpong-backend.onrender.com'),
  geminiApiKey: '', // Removed for security — Browser-side Gemini Live is disabled. Use backend exclusively.
  geminiModel: import.meta.env.VITE_GEMINI_MODEL || 'gemini-2.5-flash-native-audio-preview-09-2025',
  audio: {
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    processorBufferSize: 4096,
  },
  ui: {
    feedbackDurationMs: 2000,
    initialCountdownSeconds: 5,
  },
  motion: {
    processWidth: 320,
    processHeight: 240,
    motionThreshold: 100,
    minMotionPixels: 10,
    maxMotionPixels: 500,
    motionStopFrames: 45,
    maxFps: 20,
  },
  wakeWord: {
    phrase: 'superpong',
    commandPrefixes: ['superpong', 'super pong', 'super-pong', 'super pang', 'super bong'],
  },
};

export type RuntimeConfig = typeof runtimeConfig;
