/**
 * F3 goal watchdog — GoalManager.sweepStuckGoals.
 *
 * Verifies the fix for the "Guard Robot" problem: a goal that makes no step progress for too long
 * is aborted so the NPC returns to volition. No-progress based, so progressing goals are spared.
 * Default stuck window (30 game-min) sized from a live measurement (normal investigate advances a
 * step every ~10 game-min; 30 min of zero progress = genuinely stuck).
 */
import { describe, test, expect } from 'bun:test';
import { GoalManager, type NpcGoal } from '@clwa/engine';

function makeGoal(over: Partial<NpcGoal> = {}): NpcGoal {
  return {
    id: 'g1',
    type: 'investigate',
    ownerId: 'garrett',
    priority: 9,
    state: 'pending',
    steps: [{ action: 'wait', ticks: 5 }],
    currentStep: 0,
    data: {},
    createdAtMinute: 1000,
    ...over,
  };
}

describe('GoalManager.sweepStuckGoals (F3 goal watchdog)', () => {
  test('aborts an active goal with no step progress past stuckMinutes', () => {
    const gm = new GoalManager();
    gm.addGoal(makeGoal());
    gm.getActiveGoal('garrett'); // promote pending → active

    expect(gm.sweepStuckGoals(1000, 30)).toEqual([]); // lazy-init, not aborted
    expect(gm.sweepStuckGoals(1020, 30)).toEqual([]); // 20 min no progress, under threshold
    const aborted = gm.sweepStuckGoals(1031, 30); // 31 min no progress → abort
    expect(aborted.length).toBe(1);
    expect(aborted[0]).toMatchObject({ ownerId: 'garrett', goalType: 'investigate' });
    // Aborted goal is now 'failed' → no longer active/pending, NPC freed to re-evaluate.
    expect(gm.getActiveGoal('garrett')).toBeNull();
    expect(gm.hasActiveGoal('garrett')).toBe(false);
  });

  test('does NOT abort a goal that keeps advancing steps', () => {
    const gm = new GoalManager();
    const goal = makeGoal({ id: 'g2', ownerId: 'mark' });
    gm.addGoal(goal);
    gm.getActiveGoal('mark');
    gm.sweepStuckGoals(1000, 30); // init

    goal.currentStep = 1;
    expect(gm.sweepStuckGoals(1020, 30)).toEqual([]); // progress resets clock
    goal.currentStep = 2;
    expect(gm.sweepStuckGoals(1050, 30)).toEqual([]); // progress again
    expect(gm.getGoals('mark')[0].state).toBe('active');
  });

  test('frozen owner (player chat) is never aborted and its clock is held', () => {
    const gm = new GoalManager();
    gm.addGoal(makeGoal({ id: 'g3', ownerId: 'ted' }));
    gm.getActiveGoal('ted');
    gm.sweepStuckGoals(1000, 30); // init
    const skip = (id: string) => id === 'ted';

    // Long freeze well past the threshold — not aborted, clock reset to now (1100)
    expect(gm.sweepStuckGoals(1100, 30, skip)).toEqual([]);
    expect(gm.getGoals('ted')[0].state).toBe('active');
    // After unfreeze it needs a fresh stuck window measured from the reset (1100)
    expect(gm.sweepStuckGoals(1110, 30)).toEqual([]);
    expect(gm.sweepStuckGoals(1131, 30).length).toBe(1); // 31 min after reset
  });

  test('stuckMinutes <= 0 disables the watchdog entirely', () => {
    const gm = new GoalManager();
    gm.addGoal(makeGoal({ id: 'g4', ownerId: 'bess' }));
    gm.getActiveGoal('bess');
    gm.sweepStuckGoals(1000, 0);
    expect(gm.sweepStuckGoals(99999, 0)).toEqual([]);
    expect(gm.getGoals('bess')[0].state).toBe('active');
  });

  test('only the active goal is swept — pending goals are ignored', () => {
    const gm = new GoalManager();
    gm.addGoal(makeGoal({ id: 'g5', ownerId: 'hilda' })); // never activated → stays pending
    gm.sweepStuckGoals(1000, 30);
    expect(gm.sweepStuckGoals(2000, 30)).toEqual([]);
    expect(gm.getGoals('hilda')[0].state).toBe('pending');
  });
});
