import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MatchState } from '../store/matchState';
import { useAgentConnection } from '../hooks/useAgentConnection';
import { useWakeWord } from '../hooks/useWakeWord';
import { Mic, MicOff, Pause, Play, Square, Cpu, Globe, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface Props {
  matchState: MatchState;
  updateMatch: (updates: Partial<MatchState> | ((prev: MatchState) => Partial<MatchState>)) => void;
  endMatch: () => void;
}

export function LiveHud({ matchState, updateMatch, endMatch }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [highlightedPlayer, setHighlightedPlayer] = useState<'player1' | 'player2' | null>(null);
  const [countdown, setCountdown] = useState<number | null>(
    matchState.player1_score === 0 && matchState.player2_score === 0 ? 15 : null
  );

  // Countdown timer effect
  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCountdown(null);
    }
  }, [countdown]);

  // Win condition effect
  useEffect(() => {
    if (matchState.status !== 'active') return;

    const target = matchState.points_to_win || 11;
    const p1 = matchState.player1_score;
    const p2 = matchState.player2_score;

    if ((p1 >= target || p2 >= target) && Math.abs(p1 - p2) >= 2) {
      if (p1 > p2) {
        const newPlayer1Games = matchState.player1_games + 1;
        const isMatchWinner = newPlayer1Games >= Math.ceil(matchState.best_of / 2);
        updateMatch({ player1_games: newPlayer1Games, status: isMatchWinner ? 'ended' : 'set_ended' });
      } else {
        const newPlayer2Games = matchState.player2_games + 1;
        const isMatchWinner = newPlayer2Games >= Math.ceil(matchState.best_of / 2);
        updateMatch({ player2_games: newPlayer2Games, status: isMatchWinner ? 'ended' : 'set_ended' });
      }
    }
  }, [matchState.player1_score, matchState.player2_score, matchState.status]);

  const showFeedback = (action: string, player?: 'player1' | 'player2') => {
    setLastAction(action);
    if (player) setHighlightedPlayer(player);
    setTimeout(() => {
      setLastAction(null);
      setHighlightedPlayer(null);
    }, 2000);
  };

  const handleFunctionCall = (name: string, args: any) => {
    if (countdown !== null) return;

    if (name === 'add_point') {
      if (args.player === 'player1') {
        updateMatch(prev => ({ player1_score: prev.player1_score + 1 }));
        showFeedback('+1 Point', 'player1');
      } else if (args.player === 'player2') {
        updateMatch(prev => ({ player2_score: prev.player2_score + 1 }));
        showFeedback('+1 Point', 'player2');
      }
    } else if (name === 'pause_match') {
      updateMatch({ status: 'paused' });
      showFeedback('Match Paused');
    } else if (name === 'resume_match') {
      updateMatch({ status: 'active' });
      showFeedback('Match Resumed');
    } else if (name === 'override_score') {
      updateMatch({ player1_score: args.score1, player2_score: args.score2 });
      showFeedback('Score Overridden');
    } else if (name === 'set_camera_view') {
      updateMatch({ camera_view: args.view });
      showFeedback(`Camera: ${args.view}`);
    } else if (name === 'set_serving') {
      updateMatch({ serving: args.player });
      showFeedback('Server Updated', args.player);
    } else if (name === 'add_game_win') {
      if (args.player === 'player1') {
        updateMatch(prev => ({ player1_games: prev.player1_games + 1, current_game: prev.current_game + 1, player1_score: 0, player2_score: 0 }));
        showFeedback('Game Won!', 'player1');
      } else if (args.player === 'player2') {
        updateMatch(prev => ({ player2_games: prev.player2_games + 1, current_game: prev.current_game + 1, player1_score: 0, player2_score: 0 }));
        showFeedback('Game Won!', 'player2');
      }
    }
  };

  const { mode, isConnected, isListening, lastMessage, connect, disconnect, toggleListening, sendTextMessage, sendStateUpdate } = useAgentConnection(matchState, handleFunctionCall);

  // Wake word: once "SuperPong" is heard, connect the AI and stop the wake listener
  const handleWakeWord = useCallback(async () => {
    showFeedback('SuperPong activated! 🎉');
    await connect();
  }, [connect]);

  const { isWatching: wakeWatching, isActivated: wakeActivated, start: startWake, stop: stopWake } = useWakeWord(handleWakeWord);

  // Start passive wake word listening as soon as the match is active
  useEffect(() => {
    if (matchState.status === 'active' && !wakeActivated) {
      startWake();
    }
  }, [matchState.status, wakeActivated, startWake]);

  // Once Gemini is connected, kill the wake word listener — no interference
  useEffect(() => {
    if (isConnected) {
      stopWake();
    }
  }, [isConnected, stopWake]);

  // Send state updates to the agent whenever the score changes via UI
  const prevStateRef = useRef({ s1: matchState.player1_score, s2: matchState.player2_score, st: matchState.status });
  useEffect(() => {
    const prev = prevStateRef.current;
    if (
      prev.s1 !== matchState.player1_score ||
      prev.s2 !== matchState.player2_score ||
      prev.st !== matchState.status
    ) {
      sendStateUpdate(matchState);
      prevStateRef.current = { s1: matchState.player1_score, s2: matchState.player2_score, st: matchState.status };
    }
  }, [matchState.player1_score, matchState.player2_score, matchState.status, sendStateUpdate, matchState]);

  // Lock orientation to landscape on mobile
  useEffect(() => {
    try {
      const so = screen.orientation as any;
      if (so && so.lock) {
        so.lock('landscape').catch((e: any) => console.log('Orientation lock not supported/allowed:', e));
      }
    } catch (e) {}
    
    return () => {
      try {
        const so = screen.orientation as any;
        if (so && so.unlock) {
          so.unlock();
        }
      } catch (e) {}
    };
  }, []);

  useEffect(() => {
    // Start camera
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      })
      .catch(err => console.error("Camera error:", err));

    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Robust OpenCV-style Frame Differencing Tracker
  useEffect(() => {
    if (matchState.status !== 'active' || countdown !== null) return;
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let animationFrameId: number;
    let lastFrameData: Uint8ClampedArray | null = null;
    let framesWithoutMotion = 0;
    let lastKnownSide: 'left' | 'right' | null = null;
    let rallyActive = false;

    // We process a smaller version of the frame for performance
    const processWidth = 320;
    const processHeight = 240;
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = processWidth;
    offscreenCanvas.height = processHeight;
    const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

    const trackMotion = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA && offscreenCtx) {
        // Draw scaled down video frame
        offscreenCtx.drawImage(video, 0, 0, processWidth, processHeight);
        const currentFrame = offscreenCtx.getImageData(0, 0, processWidth, processHeight);
        const data = currentFrame.data;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (lastFrameData) {
          let sumX = 0;
          let sumY = 0;
          let motionPixels = 0;
          
          // Frame differencing
          for (let i = 0; i < data.length; i += 4) {
            const rDiff = Math.abs(data[i] - lastFrameData[i]);
            const gDiff = Math.abs(data[i+1] - lastFrameData[i+1]);
            const bDiff = Math.abs(data[i+2] - lastFrameData[i+2]);
            
            // Threshold for motion
            if (rDiff + gDiff + bDiff > 100) {
              const pixelIndex = i / 4;
              const x = pixelIndex % processWidth;
              const y = Math.floor(pixelIndex / processWidth);
              
              // Ignore top and bottom edges to reduce noise
              if (y > processHeight * 0.2 && y < processHeight * 0.8) {
                sumX += x;
                sumY += y;
                motionPixels++;
              }
            }
          }

          if (motionPixels > 10 && motionPixels < 500) { // Filter out massive camera movements
            rallyActive = true;
            framesWithoutMotion = 0;
            
            // Calculate center of motion
            const avgX = sumX / motionPixels;
            const avgY = sumY / motionPixels;
            
            // Scale back up to actual canvas size
            const scaleX = canvas.width / processWidth;
            const scaleY = canvas.height / processHeight;
            const targetX = avgX * scaleX;
            const targetY = avgY * scaleY;

            lastKnownSide = targetX < canvas.width / 2 ? 'left' : 'right';

            // Draw tracker
            ctx.beginPath();
            ctx.arc(targetX, targetY, 15, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(59, 130, 246, 0.3)'; // blue-500
            ctx.fill();
            ctx.strokeStyle = '#3b82f6';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw crosshairs
            ctx.beginPath();
            ctx.moveTo(targetX - 25, targetY);
            ctx.lineTo(targetX + 25, targetY);
            ctx.moveTo(targetX, targetY - 25);
            ctx.lineTo(targetX, targetY + 25);
            ctx.stroke();
          } else {
            if (rallyActive) {
              framesWithoutMotion++;
              
              // If motion stops for ~1.5 seconds, assume rally ended / point scored
              if (framesWithoutMotion > 45 && lastKnownSide) {
                const scoringPlayer = lastKnownSide === 'left' ? 'player2' : 'player1';
                
                if (isConnected) {
                  sendTextMessage(`The rally ended. The ball went dead on the ${lastKnownSide} side. ${scoringPlayer === 'player1' ? matchState.player1_name : matchState.player2_name} scores a point! Call the add_point function and announce it enthusiastically.`);
                }
                
                rallyActive = false;
                framesWithoutMotion = 0;
                lastKnownSide = null;
              }
            }
          }
        }
        
        // Store current frame for next comparison
        lastFrameData = new Uint8ClampedArray(data);
      }
      animationFrameId = requestAnimationFrame(trackMotion);
    };

    const resizeCanvas = () => {
      if (video && canvas) {
        canvas.width = video.clientWidth;
        canvas.height = video.clientHeight;
      }
    };
    
    window.addEventListener('resize', resizeCanvas);
    setTimeout(resizeCanvas, 500);

    trackMotion();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, [matchState.status, isConnected, sendTextMessage, matchState.player1_name, matchState.player2_name]);

  const isGamePoint = (matchState.player1_score >= 10 || matchState.player2_score >= 10) && Math.abs(matchState.player1_score - matchState.player2_score) >= 1;
  const isDeuce = matchState.player1_score >= 10 && matchState.player1_score === matchState.player2_score;
  
  let headerColor = 'bg-zinc-900/80';
  let headerText = 'POINT';
  if (isGamePoint) {
    headerColor = 'bg-amber-500';
    headerText = 'GAME POINT';
  } else if (isDeuce) {
    headerColor = 'bg-red-500';
    headerText = 'DEUCE';
  }

  // Camera view styles
  let videoTransform = 'scale(1) translate(0, 0)';
  if (matchState.camera_view === 'center') videoTransform = 'scale(1.5) translate(0, 0)';
  if (matchState.camera_view === 'left') videoTransform = 'scale(1.5) translate(15%, 0)';
  if (matchState.camera_view === 'right') videoTransform = 'scale(1.5) translate(-15%, 0)';

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
          transition={{ duration: 0.8, ease: "easeInOut" }}
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
          <div className="opacity-80">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Main Score Overlay */}
      {countdown !== null ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6">
            <h2 className="text-3xl font-bold tracking-widest text-emerald-400 uppercase">Match Starts In</h2>
            <div className="text-9xl font-black font-mono tracking-tighter text-white animate-pulse">
              {countdown}
            </div>
            <button onClick={() => setCountdown(null)} className="mt-8 px-6 py-2 border border-white/20 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-white/10 transition-colors">
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
          <div>ELAPSED <span className="text-white ml-2">12:34</span></div>
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
          <button onClick={() => updateMatch({ status: matchState.status === 'paused' ? 'active' : 'paused' })} className="p-4 bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors">
            {matchState.status === 'paused' ? <Play size={20} /> : <Pause size={20} />}
          </button>
          <button onClick={endMatch} className="p-4 bg-red-500/20 text-red-500 rounded-full hover:bg-red-500/30 transition-colors">
            <Square size={20} />
          </button>
        </div>
      </div>

      {/* Wake Word + Gemini Controls (Right Side) */}
      <div className="absolute bottom-24 right-8 z-30 flex flex-col gap-4">
        <div className="bg-zinc-900/80 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex flex-col items-center gap-3 w-64">
          {/* Connection mode indicator */}
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest uppercase w-full justify-center">
            {mode === 'checking' && <span className="text-yellow-400 animate-pulse">Checking agent...</span>}
            {mode === 'agent' && (
              <span className="text-emerald-400 flex items-center gap-1"><Cpu size={12} /> Vision Agent</span>
            )}
            {mode === 'browser-fallback' && (
              <span className="text-sky-400 flex items-center gap-1"><Globe size={12} /> Gemini Live</span>
            )}
            {mode === 'idle' && !isConnected && (
              <span className="text-zinc-500 flex items-center gap-1"><Zap size={12} /> Standby</span>
            )}
          </div>

          {!isConnected ? (
            <div className="flex flex-col items-center gap-2 w-full">
              {/* Wake word hint badge */}
              {!wakeActivated && (
                <div className={`flex items-center gap-2 w-full justify-center py-2 px-3 rounded-xl border text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  wakeWatching ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10 animate-pulse' : 'border-zinc-700 text-zinc-500'
                }`}>
                  <Zap size={10} />
                  {wakeWatching ? 'Say "SuperPong" to activate' : 'Initialising listener...'}
                </div>
              )}
              <button onClick={connect} className="w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold py-2 rounded-xl text-[10px] uppercase tracking-wider transition-colors border border-zinc-700">
                Manual Connect
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 w-full">
                <button 
                  onClick={toggleListening}
                  className={`p-3 rounded-full transition-colors shrink-0 ${isListening ? 'bg-emerald-500 text-zinc-950 shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-zinc-800 text-zinc-400'}`}
                >
                  {isListening ? <Mic size={20} /> : <MicOff size={20} />}
                </button>
                <div className="flex-1 bg-zinc-950 rounded-lg p-2 min-h-[44px] border border-zinc-800 flex items-center overflow-hidden">
                  <p className="text-xs text-zinc-300 italic truncate">
                    {lastMessage || 'Listening...'}
                  </p>
                </div>
              </div>
              <button onClick={disconnect} className="text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-widest">
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
