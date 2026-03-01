export type MatchStatus = 'idle' | 'active' | 'paused' | 'set_ended' | 'ended';

export interface MatchEvent {
  type: 'point' | 'pause' | 'resume';
  player?: 'player1' | 'player2';
  timestamp: number;
}

export interface MatchState {
  player1_name: string;
  player2_name: string;
  player1_score: number;
  player2_score: number;
  player1_games: number;
  player2_games: number;
  current_game: number;
  serving: 'player1' | 'player2';
  camera_view: 'center' | 'left' | 'right' | 'wide';
  best_of: number;
  points_to_win: number;
  status: MatchStatus;
  events: MatchEvent[];
  created_at: number | null;
}

const MATCH_KEY = "spikesense_match";

export const getMatchState = (): MatchState => {
  const stored = localStorage.getItem(MATCH_KEY);
  if (stored) {
    return JSON.parse(stored);
  }
  return {
    player1_name: "Player 1",
    player2_name: "Player 2",
    player1_score: 0,
    player2_score: 0,
    player1_games: 0,
    player2_games: 0,
    current_game: 1,
    serving: 'player1',
    camera_view: 'wide',
    best_of: 3,
    points_to_win: 11,
    status: "idle",
    events: [],
    created_at: null,
  };
};

export const saveMatchState = (state: MatchState) => {
  localStorage.setItem(MATCH_KEY, JSON.stringify(state));
};

export const clearMatchState = () => {
  localStorage.removeItem(MATCH_KEY);
};
