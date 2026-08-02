export type GameMode = 'quick-test' | 'release-run' | 'endless-defect' | 'calm';
export type ChallengeType =
  | 'visual-glitch'
  | 'logic-repair'
  | 'api-shield'
  | 'accessibility-rescue'
  | 'performance-crisis'
  | 'security-breach'
  | 'release-boss';
export interface Challenge {
  id: string;
  type: ChallengeType;
  title: string;
  maxScore: number;
  timeLimitSeconds?: number;
}
export interface GameState {
  phase: 'menu' | 'playing' | 'results';
  mode?: GameMode;
  score: number;
  streak: number;
  completed: number;
}
export type GameAction =
  | { type: 'START'; mode: GameMode }
  | { type: 'COMPLETE'; correct: boolean; elapsedSeconds: number; challenge: Challenge }
  | { type: 'FINISH' }
  | { type: 'RESET' };
export const initialGameState: GameState = { phase: 'menu', score: 0, streak: 0, completed: 0 };
export function scoreChallenge(
  challenge: Challenge,
  correct: boolean,
  elapsedSeconds: number,
  streak: number,
): number {
  if (!correct || !Number.isFinite(elapsedSeconds)) return 0;
  elapsedSeconds = Math.max(0, elapsedSeconds);
  const calm = challenge.timeLimitSeconds === undefined;
  const timeBonus = calm ? 0 : Math.max(0, (challenge.timeLimitSeconds ?? 0) - elapsedSeconds);
  return Math.min(challenge.maxScore, 100 + timeBonus * 2 + Math.min(streak, 5) * 20);
}
export function gameReducer(state: GameState, action: GameAction): GameState {
  if (action.type === 'START')
    return { phase: 'playing', mode: action.mode, score: 0, streak: 0, completed: 0 };
  if (action.type === 'COMPLETE' && state.phase === 'playing') {
    const nextStreak = action.correct ? state.streak + 1 : 0;
    return {
      ...state,
      score:
        state.score +
        scoreChallenge(action.challenge, action.correct, action.elapsedSeconds, nextStreak),
      streak: nextStreak,
      completed: state.completed + 1,
    };
  }
  if (action.type === 'FINISH' && state.phase === 'playing') return { ...state, phase: 'results' };
  if (action.type === 'RESET') return initialGameState;
  return state;
}
