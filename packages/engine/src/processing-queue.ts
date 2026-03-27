// ─── Processing Queue ───
// Async task queue for Clock-Driven Architecture.
// Master Clock enqueues tasks, queue processes them one at a time.
// setTimeout(0) between tasks yields to event loop (clock keeps ticking).

export type TaskType =
  | 'DAY_ADVANCE'
  | 'BODY_DISCOVERY'
  | 'PHASE_HANDLERS'
  | 'VOLITION'
  | 'GOAL_STEP'
  | 'CONVERSATION'
  | 'CONVERSATION_IMPACT';

export interface ProcessingTask {
  id: string;
  type: TaskType;
  /** 0 = critical (day advance), 1 = urgent (discovery), 2 = normal (volition/goals), 3 = low (conversation/phase) */
  priority: number;
  npcId?: string;
  targetNpcId?: string;
  enqueuedAt: number;
}

export type TaskHandler = (task: ProcessingTask) => Promise<void>;

export class ProcessingQueue {
  private queue: ProcessingTask[] = [];
  private _processing = false;
  private _handler: TaskHandler;
  private _onEmpty?: () => void;

  constructor(handler: TaskHandler, onEmpty?: () => void) {
    this._handler = handler;
    this._onEmpty = onEmpty;
  }

  get isProcessing(): boolean { return this._processing; }
  get length(): number { return this.queue.length; }
  get pending(): ReadonlyArray<ProcessingTask> { return this.queue; }

  /**
   * Enqueue a task. Returns false if dedup prevents it.
   * Automatically kicks the consumer if not running.
   */
  enqueue(task: ProcessingTask): boolean {
    // Dedup: same type + npcId already pending
    if (task.npcId) {
      if (this.queue.some(t => t.type === task.type && t.npcId === task.npcId)) return false;
    }

    // Conversation dedup: same pair in either order
    if (task.type === 'CONVERSATION' && task.targetNpcId) {
      const exists = this.queue.some(t =>
        t.type === 'CONVERSATION' &&
        ((t.npcId === task.npcId && t.targetNpcId === task.targetNpcId) ||
         (t.npcId === task.targetNpcId && t.targetNpcId === task.npcId)),
      );
      if (exists) return false;
    }

    // Global task dedup (DAY_ADVANCE, PHASE_HANDLERS)
    if (!task.npcId && this.queue.some(t => t.type === task.type)) return false;

    this.queue.push(task);
    this.queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);

    if (!this._processing) {
      this._processNext();
    }
    return true;
  }

  /** Process next task in queue. Yields to event loop between tasks. */
  private async _processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this._processing = false;
      this._onEmpty?.();
      return;
    }
    this._processing = true;
    const task = this.queue.shift()!;

    try {
      await this._handler(task);
    } catch (err) {
      console.error(`[Queue] ${task.type}${task.npcId ? ':' + task.npcId : ''} failed:`, err);
    }

    // Yield to event loop — lets Master Clock fire between tasks
    setTimeout(() => this._processNext(), 0);
  }

  /** Clear all pending tasks (e.g., on shutdown) */
  clear(): void {
    this.queue.length = 0;
  }

  /** Check if a specific NPC has a pending task of given type */
  hasPending(type: TaskType, npcId: string): boolean {
    return this.queue.some(t => t.type === type && t.npcId === npcId);
  }
}
