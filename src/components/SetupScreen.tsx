import React, { useState } from 'react';
import { MatchState } from '../store/matchState';

interface Props {
  onStart: (state: Partial<MatchState>) => void;
}

export function SetupScreen({ onStart }: Props) {
  const [player1, setPlayer1] = useState('Player 1');
  const [player2, setPlayer2] = useState('Player 2');
  const [bestOf, setBestOf] = useState(3);
  const [pointsToWin, setPointsToWin] = useState(11);

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md bg-zinc-900 rounded-3xl p-8 shadow-2xl border border-zinc-800">
        <div className="flex flex-col items-center mb-8">
          <img src="/favicon.ico" alt="SuperPong Logo" className="w-20 h-20 mb-4 rounded-2xl shadow-xl border border-zinc-800" />
          <h1 className="text-4xl font-black text-center tracking-tighter text-emerald-400">SuperPong</h1>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Player 1</label>
            <input
              type="text"
              value={player1}
              onChange={e => setPlayer1(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Player 2</label>
            <input
              type="text"
              value={player2}
              onChange={e => setPlayer2(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Points to Win</label>
            <div className="flex gap-4">
              {[11, 21].map(num => (
                <button
                  key={num}
                  onClick={() => setPointsToWin(num)}
                  className={`flex-1 py-3 rounded-xl font-bold transition-colors ${pointsToWin === num ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Best of</label>
            <div className="flex gap-4">
              {[1, 3, 5].map(num => (
                <button
                  key={num}
                  onClick={() => setBestOf(num)}
                  className={`flex-1 py-3 rounded-xl font-bold transition-colors ${bestOf === num ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-950 border border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => onStart({ player1_name: player1, player2_name: player2, best_of: bestOf, points_to_win: pointsToWin, status: 'active', created_at: Date.now() })}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-black text-lg py-4 rounded-xl mt-4 transition-colors uppercase tracking-wider"
          >
            Start Match
          </button>
        </div>
      </div>
    </div>
  );
}
