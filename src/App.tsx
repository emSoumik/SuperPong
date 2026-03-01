import React, { useState, useEffect } from 'react';
import { SetupScreen } from './components/SetupScreen';
import { LiveHud } from './components/LiveHud';
import { PostMatch } from './components/PostMatch';
import { getMatchState, saveMatchState, clearMatchState, MatchState } from './store/matchState';

export default function App() {
  const [matchState, setMatchState] = useState<MatchState>(getMatchState());

  useEffect(() => {
    saveMatchState(matchState);
  }, [matchState]);

  const updateMatch = (updates: Partial<MatchState> | ((prev: MatchState) => Partial<MatchState>)) => {
    setMatchState(prev => {
      const newUpdates = typeof updates === 'function' ? updates(prev) : updates;
      return { ...prev, ...newUpdates };
    });
  };

  const startMatch = (state: Partial<MatchState>) => {
    updateMatch(state);
  };

  const endMatch = () => {
    updateMatch({ status: 'ended' });
  };

  const newMatch = () => {
    clearMatchState();
    setMatchState(getMatchState());
  };

  const nextSet = () => {
    updateMatch(prev => ({
      status: 'active',
      player1_score: 0,
      player2_score: 0,
      current_game: prev.current_game + 1,
    }));
  };

  if (matchState.status === 'idle') {
    return <SetupScreen onStart={startMatch} />;
  }

  if (matchState.status === 'active' || matchState.status === 'paused') {
    return <LiveHud matchState={matchState} updateMatch={updateMatch} endMatch={endMatch} />;
  }

  if (matchState.status === 'ended' || matchState.status === 'set_ended') {
    return <PostMatch matchState={matchState} onNewMatch={newMatch} onNextSet={nextSet} />;
  }

  return null;
}
