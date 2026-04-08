import type { GoalStep, NpcGoal } from './goals';

// ─── Time Constants ───

export const MINUTES_PER_DAY = 1440;

/** @deprecated Use MINUTES_PER_DAY. Kept for backward compat with old save format. */
export const TICKS_PER_DAY = 96;

const TIME_PERIODS = ['dawn', 'morning', 'afternoon', 'evening', 'night'] as const;
export type TimePeriod = (typeof TIME_PERIODS)[number];

/** Map minute-of-day (0-1439) to a named period */
export function getTimePeriod(minuteOfDay: number): TimePeriod {
  // dawn:      05:00-07:00 → 300-420
  // morning:   07:00-12:00 → 420-720
  // afternoon: 12:00-17:00 → 720-1020
  // evening:   17:00-21:00 → 1020-1260
  // night:     21:00-05:00 → 1260-1440+0-300
  const m = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  if (m >= 300 && m < 420) return 'dawn';
  if (m >= 420 && m < 720) return 'morning';
  if (m >= 720 && m < 1020) return 'afternoon';
  if (m >= 1020 && m < 1260) return 'evening';
  return 'night'; // 1260-1440+0-300
}

/** Get human-readable HH:MM string from minute-of-day (0-1439) */
export function minuteToHour(minuteOfDay: number): string {
  const m = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(m / 60);
  const minutes = m % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/** @deprecated Use minuteToHour. Converts old tick to hour string. */
export function tickToHour(tickInDay: number): string {
  return minuteToHour(tickInDay * 15);
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
   * Get the active schedule entry for an NPC at a given minute-of-day.
   * Returns the entry for the current time period, or null if none.
   */
  getActiveEntry(npcId: string, minuteOfDay: number): ScheduleEntry | null {
    const period = getTimePeriod(minuteOfDay);
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
    minuteOfDay: number,
    npcLocations: Map<string, string>,
    hasActiveGoal: (id: string) => boolean,
  ): NpcGoal[] {
    const goals: NpcGoal[] = [];

    for (const npcId of npcIds) {
      const entry = this.getActiveEntry(npcId, minuteOfDay);
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
        createdAtMinute: 0, // will be set by caller
        isRoutine: true,
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
  getTimeInfo(minuteOfDay: number): { minuteOfDay: number; period: TimePeriod; hour: string } {
    return {
      minuteOfDay,
      period: getTimePeriod(minuteOfDay),
      hour: minuteToHour(minuteOfDay),
    };
  }
}
