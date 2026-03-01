import React, { useEffect, useRef, useState, useMemo } from 'react';
import { MatchState } from '../store/matchState';
import { useAgentConnection } from '../hooks/useAgentConnection';
import { GeminiStatus } from '../hooks/useGeminiLive';
import { Mic, MicOff, Pause, Play, Square, Cpu, Globe, Zap, Wifi, WifiOff, RefreshCw, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { runtimeConfig } from '../config/runtime';
import { logger } from '../lib/logger';

interface Props {
  matchState: MatchState;
  updateMatch: (updates: Partial<MatchState> | ((prev: MatchState) => Partial<MatchState>)) => void;
  endMatch: () => void;
}

const STATUS_MAP: Record<GeminiStatus, { label: string; color: string; Icon: React.ElementType; pulse: boolean }> = {
  idle: { label: 'Standby', color: 'text-zinc-500', Icon: Zap, pulse: false },
  connecting: { label: 'Connecting…', color: 'text-amber-400', Icon: Wifi, pulse: true },
  connected: { label: 'Voice Active', color: 'text-emerald-400', Icon: Wifi, pulse: false },
  reconnecting: { label: 'Reconnecting…', color: 'text-amber-400', Icon: RefreshCw, pulse: true },
  error: { label: 'Error', color: 'text-red-400', Icon: AlertCircle, pulse: false },
};

export function LiveHud({ matchState, updateMatch, endMatch }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [highlightedPlayer, setHighlightedPlayer] = useState<'player1' | 'player2' | null>(null);
  const [showError, setShowError] = useState(false);
  const [errorTimer, setErrorTimer] = useState(5);
  const [localError, setLocalError] = useState<{ title: string; hint: string } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(
    matchState.player1_score === 0 && matchState.player2_score === 0 ? runtimeConfig.ui.initialCountdownSeconds : null,
  );
  const sentInitialSyncRef = useRef(false);

  // Handles the match start countdown
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(t);
    } else {
      setCountdown(null);
    }
  }, [countdown]);

  // Check if someone has won the set or match
  useEffect(() => {
    if (matchState.status !== 'active') return;

    const target = matchState.points_to_win || 11;
    const p1 = matchState.player1_score;
    const p2 = matchState.player2_score;

    if ((p1 >= target || p2 >= target) && Math.abs(p1 - p2) >= 2) {
      if (p1 > p2) {
        const g = matchState.player1_games + 1;
        const isWinner = g >= Math.ceil(matchState.best_of / 2);
        updateMatch({ player1_games: g, status: isWinner ? 'ended' : 'set_ended' });
      } else {
        const g = matchState.player2_games + 1;
        const isWinner = g >= Math.ceil(matchState.best_of / 2);
        updateMatch({ player2_games: g, status: isWinner ? 'ended' : 'set_ended' });
      }
    }
  }, [matchState.player1_score, matchState.player2_score, matchState.status]);

  // Manage serve rotation (swaps every 2 points, or every point in deuce)
  useEffect(() => {
    if (matchState.status !== 'active') return;
    const total = matchState.player1_score + matchState.player2_score;
    let nextServing: 'player1' | 'player2';
    if (total >= 20) {
      // Deuce: alternate every point
      nextServing = total % 2 === 0 ? 'player1' : 'player2';
    } else {
      // Normal: every 2 points
      nextServing = (Math.floor(total / 2) % 2 === 0) ? 'player1' : 'player2';
    }
    if (nextServing !== matchState.serving) {
      updateMatch({ serving: nextServing });
    }
  }, [matchState.player1_score, matchState.player2_score, matchState.status]);

  // Visual UI feedback for point/set wins
  const showFeedback = (action: string, player?: 'player1' | 'player2') => {
    setLastAction(action);
    if (player) setHighlightedPlayer(player);
    setTimeout(() => {
      setLastAction(null);
      setHighlightedPlayer(null);
    }, runtimeConfig.ui.feedbackDurationMs);
  };

  // Handle point updates and state changes from the AI voice agent
  const handleFunctionCall = (name: string, args: any) => {
    if (countdown !== null) return;

    switch (name) {
      case 'add_point': {
        const count = args.count ? Number(args.count) : 1;
        if (args.player === 'player1') {
          updateMatch(prev => ({ player1_score: prev.player1_score + count }));
          showFeedback(`+${count} Point${count > 1 ? 's' : ''}`, 'player1');
        } else if (args.player === 'player2') {
          updateMatch(prev => ({ player2_score: prev.player2_score + count }));
          showFeedback(`+${count} Point${count > 1 ? 's' : ''}`, 'player2');
        }
        break;
      }
      case 'pause_match':
        updateMatch({ status: 'paused' });
        showFeedback('Match Paused');
        break;
      case 'resume_match':
        updateMatch({ status: 'active' });
        showFeedback('Match Resumed');
        break;
      case 'end_match':
        updateMatch({ status: 'ended' });
        showFeedback('Match Ended');
        break;
      case 'override_score':
        updateMatch({ player1_score: args.score1, player2_score: args.score2 });
        showFeedback('Score Overridden');
        break;
      case 'set_camera_view':
        updateMatch({ camera_view: args.view });
        showFeedback(`Camera: ${args.view}`);
        break;
      case 'set_serving':
        updateMatch({ serving: args.player });
        showFeedback('Server Updated', args.player);
        break;
      case 'add_game_win':
        if (args.player === 'player1') {
          updateMatch(prev => ({
            player1_games: prev.player1_games + 1,
            current_game: prev.current_game + 1,
            player1_score: 0,
            player2_score: 0,
          }));
          showFeedback('Game Won!', 'player1');
        } else if (args.player === 'player2') {
          updateMatch(prev => ({
            player2_games: prev.player2_games + 1,
            current_game: prev.current_game + 1,
            player1_score: 0,
            player2_score: 0,
          }));
          showFeedback('Game Won!', 'player2');
        }
        break;
      case 'get_score':
        // AI reads the score — no UI update needed
        break;
    }
  };

  const {
    mode,
    isConnected,
    isListening,
    lastMessage,
    geminiStatus,
    errorHint,
    connect,
    disconnect,
    toggleListening,
    sendTextMessage,
    sendStateUpdate,
  } = useAgentConnection(matchState, handleFunctionCall);

  const activeError = localError || errorHint;

  useEffect(() => {
    if (activeError) {
      setShowError(true);
      setErrorTimer(5);
    } else {
      setShowError(false);
    }
  }, [activeError?.title, activeError?.hint]);

  useEffect(() => {
    if (showError && errorTimer > 0) {
      const id = setInterval(() => {
        setErrorTimer(prev => {
          if (prev <= 1) {
            setShowError(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(id);
    }
  }, [showError, errorTimer]);

  // Send initial match data to the agent once connected
  useEffect(() => {
    if (!isConnected || sentInitialSyncRef.current) return;
    sendStateUpdate(matchState);
    sentInitialSyncRef.current = true;
  }, [isConnected, sendStateUpdate, matchState]);

  useEffect(() => {
    if (!isConnected) sentInitialSyncRef.current = false;
  }, [isConnected]);

  // Best effort to keep the UI in landscape for mobile
  useEffect(() => {
    try {
      const so = screen.orientation as any;
      if (so?.lock) {
        so.lock('landscape').catch(() => { });
      }
    } catch { }
    return () => {
      try {
        (screen.orientation as any)?.unlock?.();
      } catch { }
    };
  }, []);

  // Setup webcam stream
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setLocalError(null);
      })
      .catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        setLocalError({
          title: 'Camera Error',
          hint: msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
            ? 'Please grant camera access to enable ball tracking.'
            : 'Ensure your camera is connected and not used by another app.'
        });
        logger.error('Camera permission failed', {
          component: 'LiveHud',
          error: msg,
        });
      });

    return () => {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  // Motion-based rally tracking
  useEffect(() => {
    if (matchState.status !== 'active' || countdown !== null) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let animId: number;
    let lastFrameData: Uint8ClampedArray | null = null;
    let framesWithoutMotion = 0;
    let lastKnownSide: 'left' | 'right' | null = null;
    let rallyActive = false;

    const { processWidth: pw, processHeight: ph, maxFps, motionThreshold, minMotionPixels, maxMotionPixels, motionStopFrames } = runtimeConfig.motion;
    const minFrameInterval = 1000 / maxFps;
    const offscreen = document.createElement('canvas');
    offscreen.width = pw;
    offscreen.height = ph;
    const offCtx = offscreen.getContext('2d', { willReadFrequently: true });
    let lastTs = 0;

    const track = () => {
      const now = performance.now();
      if (now - lastTs < minFrameInterval) {
        animId = requestAnimationFrame(track);
        return;
      }
      lastTs = now;

      if (video.readyState === video.HAVE_ENOUGH_DATA && offCtx) {
        offCtx.drawImage(video, 0, 0, pw, ph);
        const frame = offCtx.getImageData(0, 0, pw, ph);
        const data = frame.data;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (lastFrameData) {
          let sumX = 0, sumY = 0, motionPx = 0;

          for (let i = 0; i < data.length; i += 4) {
            const diff = Math.abs(data[i] - lastFrameData[i])
              + Math.abs(data[i + 1] - lastFrameData[i + 1])
              + Math.abs(data[i + 2] - lastFrameData[i + 2]);

            if (diff > motionThreshold) {
              const idx = i / 4;
              const x = idx % pw;
              const y = (idx / pw) | 0;

              if (y > ph * 0.2 && y < ph * 0.8) {
                sumX += x;
                sumY += y;
                motionPx++;
              }
            }
          }

          if (motionPx > minMotionPixels && motionPx < maxMotionPixels) {
            rallyActive = true;
            framesWithoutMotion = 0;
            const avgX = sumX / motionPx;
            const avgY = sumY / motionPx;
            const sx = canvas.width / pw;
            const sy = canvas.height / ph;
            const tx = avgX * sx;
            const ty = avgY * sy;
            lastKnownSide = tx < canvas.width / 2 ? 'left' : 'right';

            // Draw tracking indicator
            ctx.beginPath();
            ctx.arc(tx, ty, 15, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(59,130,246,0.3)';
            ctx.fill();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(tx - 25, ty); ctx.lineTo(tx + 25, ty);
            ctx.moveTo(tx, ty - 25); ctx.lineTo(tx, ty + 25);
            ctx.stroke();
          } else if (rallyActive) {
            framesWithoutMotion++;
            if (framesWithoutMotion > motionStopFrames && lastKnownSide) {
              const scorer = lastKnownSide === 'left' ? 'player2' : 'player1';
              if (isConnected) {
                sendTextMessage(
                  `[SYSTEM] Rally ended. Ball died on ${lastKnownSide}. ` +
                  `Award point to ${scorer}. Call add_point first, then short commentary.`,
                );
              }
              rallyActive = false;
              framesWithoutMotion = 0;
              lastKnownSide = null;
            }
          }
        }
        lastFrameData = new Uint8ClampedArray(data);
      }
      animId = requestAnimationFrame(track);
    };

    const resize = () => {
      if (video && canvas) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
    };
    window.addEventListener('resize', resize);
    setTimeout(resize, 500);
    track();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animId);
    };
  }, [matchState.status, countdown, isConnected, sendTextMessage]);

  const isGamePoint = (matchState.player1_score >= 10 || matchState.player2_score >= 10)
    && Math.abs(matchState.player1_score - matchState.player2_score) >= 1;
  const isDeuce = matchState.player1_score >= 10 && matchState.player1_score === matchState.player2_score;

  const { headerColor, headerText } = useMemo(() => {
    if (isDeuce) return { headerColor: 'bg-red-500', headerText: 'DEUCE' };
    if (isGamePoint) return { headerColor: 'bg-amber-500', headerText: 'GAME POINT' };
    return { headerColor: 'bg-zinc-900/80', headerText: 'POINT' };
  }, [isDeuce, isGamePoint]);

  let videoTransform = 'scale(1) translate(0, 0)';
  if (matchState.camera_view === 'center') videoTransform = 'scale(1.5) translate(0, 0)';
  if (matchState.camera_view === 'left') videoTransform = 'scale(1.5) translate(15%, 0)';
  if (matchState.camera_view === 'right') videoTransform = 'scale(1.5) translate(-15%, 0)';

  const statusCfg = STATUS_MAP[geminiStatus];

  const [clockStr, setClockStr] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  useEffect(() => {
    const id = setInterval(() => setClockStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 30000);
    return () => clearInterval(id);
  }, []);

  const elapsedRef = useRef(matchState.created_at || Date.now());
  const [elapsed, setElapsed] = useState('00:00');
  useEffect(() => {
    const tick = () => {
      const diff = Math.floor((Date.now() - elapsedRef.current) / 1000);
      const m = String(Math.floor(diff / 60)).padStart(2, '0');
      const s = String(diff % 60).padStart(2, '0');
      setElapsed(`${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative h-screen w-full bg-black text-white overflow-hidden font-sans">
      {/* Background Camera Feed */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <motion.video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover opacity-60"
          animate={{ transform: videoTransform }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
        />
      </div>

      {/* Top Banner */}
      <div className={`absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-6 py-2 ${headerColor} transition-colors duration-500`}>
        <div className="text-xs font-bold tracking-widest uppercase opacity-80">
          TABLE TENNIS <span className="mx-2">—</span> SINGLES FINAL
        </div>
        <div className="font-black tracking-widest text-sm">
          {headerText}
        </div>
        <div className="flex items-center gap-4 text-xs font-bold tracking-widest">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </div>
          <div className="opacity-80">{clockStr}</div>
        </div>
      </div>

      {/* Main Score Overlay */}
      {matchState.status === 'ended' ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="flex flex-col items-center gap-6">
            <h2 className="text-4xl font-black tracking-widest text-white uppercase mb-4">Match Ended</h2>

            <div className="flex items-center gap-12 bg-zinc-900/50 p-8 rounded-3xl border border-white/10">
              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-zinc-400 mb-2">{matchState.player1_name}</span>
                <span className={`text-6xl font-black font-mono ${matchState.player1_score > matchState.player2_score ? 'text-blue-400' : 'text-white'}`}>
                  {matchState.player1_score}
                </span>
                <span className="text-xs font-bold text-zinc-500 mt-2">GAMES: {matchState.player1_games}</span>
              </div>

              <div className="text-2xl font-black text-zinc-600">—</div>

              <div className="flex flex-col items-center">
                <span className="text-sm font-bold text-zinc-400 mb-2">{matchState.player2_name}</span>
                <span className={`text-6xl font-black font-mono ${matchState.player2_score > matchState.player1_score ? 'text-red-400' : 'text-white'}`}>
                  {matchState.player2_score}
                </span>
                <span className="text-xs font-bold text-zinc-500 mt-2">GAMES: {matchState.player2_games}</span>
              </div>
            </div>

            <button
              onClick={() => {
                updateMatch({
                  status: 'idle',
                  player1_score: 0,
                  player2_score: 0,
                  player1_games: 0,
                  player2_games: 0,
                  current_game: 1
                });
                setCountdown(runtimeConfig.ui.initialCountdownSeconds);
              }}
              className="mt-8 px-8 py-4 bg-emerald-500 text-zinc-950 rounded-full text-sm font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors shadow-[0_0_20px_rgba(16,185,129,0.4)]"
            >
              Start New Match
            </button>
          </div>
        </div>
      ) : countdown !== null ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6">
            <h2 className="text-3xl font-bold tracking-widest text-emerald-400 uppercase">Match Starts In</h2>
            <div className="text-9xl font-black font-mono tracking-tighter text-white animate-pulse">
              {countdown}
            </div>
            <button
              onClick={() => setCountdown(null)}
              className="mt-8 px-6 py-2 border border-white/20 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 z-10 flex flex-col justify-center pointer-events-none">
          <div className="w-full max-w-6xl mx-auto px-8">
            <div className="grid grid-cols-2 gap-8 bg-zinc-950/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden">
              {/* Player 1 Side */}
              <motion.div
                className="p-8 flex flex-col justify-between relative"
                animate={{ backgroundColor: highlightedPlayer === 'player1' ? 'rgba(59, 130, 246, 0.2)' : 'transparent' }}
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
                <div className="flex flex-col gap-2">
                  <h2 className="text-4xl font-black tracking-tight">{matchState.player1_name}</h2>
                  <div className="flex items-center gap-4 text-sm font-bold tracking-widest uppercase text-zinc-400">
                    <span>SEED #1</span>
                    {matchState.serving === 'player1' && (
                      <span className="flex items-center gap-2 text-blue-400">
                        <div className="w-2 h-2 rounded-full bg-blue-500" />
                        SERVING
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-end mt-12">
                  <motion.div
                    key={matchState.player1_score}
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-[12rem] leading-none font-mono font-black tracking-tighter"
                  >
                    {matchState.player1_score}
                  </motion.div>
                </div>
              </motion.div>

              {/* Player 2 Side */}
              <motion.div
                className="p-8 flex flex-col justify-between relative"
                animate={{ backgroundColor: highlightedPlayer === 'player2' ? 'rgba(239, 68, 68, 0.2)' : 'transparent' }}
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-red-500" />
                <div className="flex flex-col gap-2 items-end">
                  <h2 className="text-4xl font-black tracking-tight">{matchState.player2_name}</h2>
                  <div className="flex items-center gap-4 text-sm font-bold tracking-widest uppercase text-zinc-400">
                    {matchState.serving === 'player2' && (
                      <span className="flex items-center gap-2 text-red-400">
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                        SERVING
                      </span>
                    )}
                    <span>SEED #2</span>
                  </div>
                </div>
                <div className="flex justify-start mt-12">
                  <motion.div
                    key={matchState.player2_score}
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-[12rem] leading-none font-mono font-black tracking-tighter text-zinc-300"
                  >
                    {matchState.player2_score}
                  </motion.div>
                </div>
              </motion.div>

              {/* Center Divider */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-6xl font-black text-white/20">
                :
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Info Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 bg-zinc-950/80 backdrop-blur-md border-t border-white/10 p-4 flex justify-between items-center px-8">
        <div className="flex items-center gap-6">
          <div className="bg-zinc-800 px-4 py-1.5 rounded text-xs font-bold tracking-widest uppercase">
            SET {matchState.current_game} OF {matchState.best_of}
          </div>
          {isGamePoint && (
            <div className="bg-amber-500 text-zinc-950 px-4 py-1.5 rounded text-xs font-bold tracking-widest uppercase">
              GAME POINT
            </div>
          )}
          {isDeuce && (
            <div className="bg-red-500 text-white px-4 py-1.5 rounded text-xs font-bold tracking-widest uppercase">
              DEUCE
            </div>
          )}
        </div>

        <div className="flex items-center gap-8 text-xs font-bold tracking-widest uppercase text-zinc-400">
          <div>SETS <span className="text-white ml-2">{matchState.player1_games} - {matchState.player2_games}</span></div>
          <div>ELAPSED <span className="text-white ml-2">{elapsed}</span></div>
        </div>
      </div>

      {/* Voice Command Feedback Overlay */}
      <AnimatePresence>
        {lastAction && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-zinc-950 px-6 py-3 rounded-full font-bold shadow-2xl flex items-center gap-2"
          >
            <Mic size={18} />
            {lastAction}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Center Bottom Controls (Play/Pause & End) */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 flex gap-4">
        <div className="bg-zinc-900/80 backdrop-blur-md p-2 rounded-full border border-white/10 flex gap-2 shadow-2xl">
          <button
            onClick={() => updateMatch({ status: matchState.status === 'paused' ? 'active' : 'paused' })}
            className="p-4 bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors"
          >
            {matchState.status === 'paused' ? <Play size={20} /> : <Pause size={20} />}
          </button>
          <button
            onClick={endMatch}
            className="p-4 bg-red-500/20 text-red-500 rounded-full hover:bg-red-500/30 transition-colors"
          >
            <Square size={20} />
          </button>
        </div>
      </div>

      {/* Voice Controls (Right Side) */}
      <div className="absolute bottom-24 right-8 z-30 flex flex-col gap-4">
        <div className="bg-zinc-900/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex flex-col items-center gap-3 w-64">
          {/* Connection mode + live status */}
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase w-full justify-center">
            {mode === 'checking' && <span className="text-yellow-400 animate-pulse">Checking agent…</span>}
            {mode === 'agent' && (
              <span className="text-emerald-400 flex items-center gap-1"><Cpu size={12} /> Vision Agent</span>
            )}
            {mode === 'browser-fallback' && (
              <span className={`${statusCfg.color} flex items-center gap-1 ${statusCfg.pulse ? 'animate-pulse' : ''}`}>
                <statusCfg.Icon size={12} />
                {statusCfg.label}
              </span>
            )}
            {mode === 'idle' && !isConnected && (
              <span className="text-zinc-500 flex items-center gap-1"><Zap size={12} /> Standby</span>
            )}
          </div>

          {!isConnected ? (
            <div className="flex flex-col items-center gap-2 w-full">
              <div className={`flex items-center gap-2 w-full justify-center py-2 px-3 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-colors ${geminiStatus === 'error'
                ? 'border-red-500/40 text-red-400 bg-red-500/10'
                : 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10 animate-pulse'
                }`}>
                {geminiStatus === 'error' ? <AlertCircle size={10} /> : <Zap size={10} />}
                {geminiStatus === 'error' ? 'Connection failed' :
                  geminiStatus === 'reconnecting' ? 'Reconnecting…' :
                    'Auto-connecting voice agent'}
              </div>
              <button
                onClick={() => { connect(); }}
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-2 rounded-xl text-[10px] uppercase tracking-wider transition-colors border border-zinc-700"
              >
                Retry Connect
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 w-full">
                <button
                  onClick={toggleListening}
                  className={`p-3 rounded-full transition-colors shrink-0 ${isListening
                    ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]'
                    : 'bg-zinc-800 text-zinc-400'
                    }`}
                >
                  {isListening ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <div className="flex-1 bg-zinc-950 rounded-lg p-2 min-h-[44px] border border-zinc-800 flex items-center overflow-hidden">
                  <p className="text-xs text-zinc-300 italic truncate">
                    {lastMessage || 'Listening for score events and SuperPong commands…'}
                  </p>
                </div>
              </div>
              <button
                onClick={disconnect}
                className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-widest"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
      {/* Error Hints Overlay */}
      <AnimatePresence>
        {showError && activeError && (
          <motion.div
            initial={{ opacity: 0, x: 20, y: 0 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 20, scale: 0.95 }}
            className="absolute top-24 right-8 z-50 w-80 bg-zinc-950/90 border border-red-500/50 rounded-2xl p-4 shadow-[0_0_30px_rgba(239,68,68,0.2)] backdrop-blur-xl group"
          >
            {/* Countdown bar */}
            <div className="absolute bottom-0 left-0 h-1 bg-red-500/30 rounded-full overflow-hidden w-full">
              <motion.div
                key={activeError.title}
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: 5, ease: 'linear' }}
                className="h-full bg-red-500"
              />
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-red-500/20 rounded-xl text-red-500 shrink-0">
                <AlertCircle size={22} />
              </div>
              <div className="flex-1 pr-6">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-bold text-red-400">{activeError.title}</h3>
                  <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded">
                    {errorTimer}s
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  <span className="text-red-400/80 font-semibold mr-1">Fix:</span>
                  {activeError.hint}
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowError(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
