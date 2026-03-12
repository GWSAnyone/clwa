import type { GoalStep, NpcGoal } from './goals';

// ─── Time Constants ───

export const TICKS_PER_DAY = 24;

export type TimePeriod = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

/** Map tick-within-day (0-23) to a named period */
export function getTimePeriod(tickInDay: number): TimePeriod {
  if (tickInDay >= 5 && tickInDay < 7) return 'dawn';
  if (tickInDay >= 7 && tickInDay < 12) return 'morning';
  if (tickInDay >= 12 && tickInDay < 17) return 'afternoon';
  if (tickInDay >= 17 && tickInDay < 21) return 'evening';
  return 'night'; // 21-4
}

/** Get human-readable hour string from tick */
export function tickToHour(tickInDay: number): string {
  return `${tickInDay.toString().padStart(2, '0')}:00`;
}

// ─── Schedule Entry ───

export interface ScheduleEntry {
  npcId: string;
  /** Time period when this schedule is active */
  period: TimePeriod;
  /** Target location name (not id) */
  location: string;
  /** What the NPC does there (for logging / future LLM context) */
  activity: string;
}

// ─── Schedule Manager ───

const SCHEDULE_GOAL_PRIORITY = 3;

export class ScheduleManager {
  private schedules: ScheduleEntry[] = [];
  /** Track which NPC already has an active schedule goal to avoid spam */
  private activeScheduleGoals = new Set<string>();

  constructor(schedules: ScheduleEntry[]) {
    this.schedules = schedules;
  }

  /**
   * Get the active schedule entry for an NPC at a given tick.
   * Returns the entry for the current time period, or null if none.
   */
  getActiveEntry(npcId: string, tickInDay: number): ScheduleEntry | null {
    const period = getTimePeriod(tickInDay);
    return this.schedules.find(
      (s) => s.npcId === npcId && s.period === period,
    ) ?? null;
  }

  /**
   * Check schedules for all NPCs and create goals for those not at their
   * scheduled location. Returns new goals to add.
   */
  checkSchedules(
    npcIds: string[],
    tickInDay: number,
    npcLocations: Map<string, string>,
    hasActiveGoal: (id: string) => boolean,
  ): NpcGoal[] {
    const goals: NpcGoal[] = [];

    for (const npcId of npcIds) {
      const entry = this.getActiveEntry(npcId, tickInDay);
      if (!entry) continue;

      // Already at the right location
      const currentLocation = npcLocations.get(npcId);
      if (currentLocation === entry.location) {
        this.activeScheduleGoals.delete(npcId);
        continue;
      }

      // Already has a higher-priority goal — don't interfere
      if (hasActiveGoal(npcId)) continue;

      // Already has a schedule goal in progress
      if (this.activeScheduleGoals.has(npcId)) continue;

      // Create a schedule goal: move to location
      const steps: GoalStep[] = [
        { action: 'move_to', location: entry.location },
      ];

      const goal: NpcGoal = {
        id: crypto.randomUUID(),
        type: 'schedule',
        ownerId: npcId,
        priority: SCHEDULE_GOAL_PRIORITY,
        state: 'pending',
        steps,
        currentStep: 0,
        data: {
          activity: entry.activity,
          period: entry.period,
        },
        createdAtTick: 0, // will be set by caller
      };

      this.activeScheduleGoals.add(npcId);
      goals.push(goal);
    }

    return goals;
  }

  /** Mark a schedule goal as no longer active (called when goal completes/fails) */
  clearScheduleGoal(npcId: string): void {
    this.activeScheduleGoals.delete(npcId);
  }

  /** Get all schedule entries (for API/debugging) */
  getAllEntries(): ScheduleEntry[] {
    return [...this.schedules];
  }

  /** Get current period info for API */
  getTimeInfo(tickInDay: number): { tickInDay: number; period: TimePeriod; hour: string } {
    return {
      tickInDay,
      period: getTimePeriod(tickInDay),
      hour: tickToHour(tickInDay),
    };
  }
}
