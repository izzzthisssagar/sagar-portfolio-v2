import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState, scoreChallenge, type Challenge } from './index';
const challenge: Challenge = {
  id: 'a11y-1',
  type: 'accessibility-rescue',
  title: 'Restore the label',
  maxScore: 200,
  timeLimitSeconds: 30,
};
describe('QA Rift engine', () => {
  it('moves through menu, play, and results', () => {
    const playing = gameReducer(initialGameState, { type: 'START', mode: 'quick-test' });
    expect(playing.phase).toBe('playing');
    expect(gameReducer(playing, { type: 'FINISH' }).phase).toBe('results');
  });
  it('rewards correct evidence and resets streak after failure', () => {
    let state = gameReducer(initialGameState, { type: 'START', mode: 'calm' });
    state = gameReducer(state, { type: 'COMPLETE', correct: true, elapsedSeconds: 5, challenge });
    expect(state.score).toBeGreaterThan(0);
    state = gameReducer(state, { type: 'COMPLETE', correct: false, elapsedSeconds: 2, challenge });
    expect(state.streak).toBe(0);
  });
  it('never exceeds challenge maximum', () =>
    expect(scoreChallenge(challenge, true, 0, 99)).toBe(200));
  it('does not reward invalid time and clamps negative elapsed time', () => {
    expect(scoreChallenge(challenge, true, Number.NaN, 0)).toBe(0);
    expect(scoreChallenge(challenge, true, -10, 0)).toBe(scoreChallenge(challenge, true, 0, 0));
  });
  it('ignores completion outside active play', () => {
    expect(
      gameReducer(initialGameState, {
        type: 'COMPLETE',
        correct: true,
        elapsedSeconds: 1,
        challenge,
      }),
    ).toEqual(initialGameState);
  });
});
