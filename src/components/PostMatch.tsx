import React, { useState, useEffect } from 'react';
import { MatchState } from '../store/matchState';
import { Trophy, Clock, Activity, Target, ArrowRight } from 'lucide-react';

interface Props {
  matchState: MatchState;
  onNewMatch: () => void;
  onNextSet?: () => void;
}

export function PostMatch({ matchState, onNewMatch, onNextSet }: Props) {
  const isMatchFinished = matchState.status === 'ended';
  const p1Wins = matchState.player1_games > matchState.player2_games || (matchState.player1_games === matchState.player2_games && matchState.player1_score > matchState.player2_score);
  const isDraw = matchState.player1_games === matchState.player2_games && matchState.player1_score === matchState.player2_score;
  const winner = isDraw ? "Draw" : (p1Wins ? matchState.player1_name : matchState.player2_name);

  // 10-second auto-advance countdown only for set transitions (not final match end)
  const [countdown, setCountdown] = useState<number | null>(() => (!isMatchFinished && onNextSet ? 10 : null));

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      onNextSet?.();
      return;
    }
    const t = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [countdown, onNextSet]);

  // Circumference of the SVG progress ring
  const RADIUS = 20;
  const CIRC = 2 * Math.PI * RADIUS;
  const progress = countdown !== null ? countdown / 10 : 0;

  // Calculate some mock analytics based on the score
  const totalPoints = matchState.player1_score + matchState.player2_score;
  const p1WinPct = totalPoints > 0 ? Math.round((matchState.player1_score / totalPoints) * 100) : 0;
  const p2WinPct = totalPoints > 0 ? Math.round((matchState.player2_score / totalPoints) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6 font-sans">
      <div className="w-full max-w-4xl bg-zinc-900/80 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/10">
        <div className="text-center mb-12">
          <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2 flex items-center justify-center gap-2">
            <Trophy size={14} className="text-emerald-500" />
            {isMatchFinished ? "Match Final" : `Set ${matchState.current_game} Finished`}
          </h2>
          <h1 className="text-5xl font-black tracking-tighter text-white">
            {isMatchFinished ? (isDraw ? "It's a Draw!" : `${winner} Takes the Match!`) : `${matchState.player1_score > matchState.player2_score ? matchState.player1_name : matchState.player2_name} Wins the Set!`}
          </h1>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
          {/* Player 1 Stats */}
          <div className="bg-zinc-950/50 rounded-2xl p-6 border border-blue-500/20 flex flex-col items-center">
            <h3 className="text-xl font-bold text-blue-400 mb-2">{matchState.player1_name}</h3>
            <div className="text-6xl font-black font-mono mb-4">{matchState.player1_games}</div>
            <div className="text-sm text-zinc-400 uppercase tracking-widest font-bold">Sets Won</div>
            
            <div className="w-full mt-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Total Points</span>
                <span className="font-bold">{matchState.player1_score}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Win Rate</span>
                <span className="font-bold">{p1WinPct}%</span>
              </div>
            </div>
          </div>

          {/* Center vs */}
          <div className="flex flex-col items-center justify-center">
            <div className="text-4xl text-zinc-700 font-black italic mb-8">VS</div>
            
            <div className="flex flex-col gap-4 w-full">
              <div className="bg-zinc-950/50 rounded-xl p-4 border border-white/5 flex items-center gap-4">
                <Clock size={20} className="text-emerald-500" />
                <div>
                  <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Duration</div>
                  <div className="font-mono font-bold">12:34</div>
                </div>
              </div>
              <div className="bg-zinc-950/50 rounded-xl p-4 border border-white/5 flex items-center gap-4">
                <Activity size={20} className="text-emerald-500" />
                <div>
                  <div className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Total Rallies</div>
                  <div className="font-mono font-bold">{totalPoints}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Player 2 Stats */}
          <div className="bg-zinc-950/50 rounded-2xl p-6 border border-red-500/20 flex flex-col items-center">
            <h3 className="text-xl font-bold text-red-400 mb-2">{matchState.player2_name}</h3>
            <div className="text-6xl font-black font-mono mb-4">{matchState.player2_games}</div>
            <div className="text-sm text-zinc-400 uppercase tracking-widest font-bold">Sets Won</div>
            
            <div className="w-full mt-6 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Total Points</span>
                <span className="font-bold">{matchState.player2_score}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Win Rate</span>
                <span className="font-bold">{p2WinPct}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-center gap-6">
          {!isMatchFinished && onNextSet && (
            <button 
              onClick={() => { setCountdown(null); onNextSet(); }}
              className="relative bg-blue-500 hover:bg-blue-400 text-zinc-950 font-black text-lg px-12 py-4 rounded-full transition-colors uppercase tracking-widest flex items-center gap-3"
            >
              {/* Countdown progress ring */}
              {countdown !== null && (
                <span className="relative w-10 h-10 flex items-center justify-center shrink-0">
                  <svg className="absolute inset-0 -rotate-90" width="40" height="40" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r={RADIUS} fill="none" stroke="rgba(0,0,0,0.2)" strokeWidth="4" />
                    <circle
                      cx="24" cy="24" r={RADIUS}
                      fill="none"
                      stroke="rgba(0,0,0,0.7)"
                      strokeWidth="4"
                      strokeDasharray={CIRC}
                      strokeDashoffset={CIRC * (1 - progress)}
                      strokeLinecap="round"
                      style={{ transition: 'stroke-dashoffset 1s linear' }}
                    />
                  </svg>
                  <span className="text-sm font-black z-10">{countdown}</span>
                </span>
              )}
              <ArrowRight size={20} />
              Start Next Set
            </button>
          )}
          <button 
            onClick={onNewMatch}
            className={`${isMatchFinished ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'} font-black text-lg px-12 py-4 rounded-full transition-colors uppercase tracking-widest flex items-center gap-2`}
          >
            <Target size={24} />
            {isMatchFinished ? "Start New Match" : "End Match Early"}
          </button>
        </div>
      </div>
    </div>
  );
}
