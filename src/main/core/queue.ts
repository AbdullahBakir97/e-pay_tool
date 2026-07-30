/**
 * Bounded-concurrency task runner.
 *
 * Bounded, not unbounded: eBay rate-limits per application, so firing 100
 * simultaneous requests would trip the limit for no wall-clock gain. The
 * UI stays responsive either way because all of this runs in the main
 * process, off the renderer's thread.
 */

export class TaskQueue {
  private active = 0
  private readonly pending: Array<() => void> = []

  constructor(private readonly limit: number = 4) {
    if (limit < 1) throw new Error('Queue limit must be at least 1.')
  }

  /** Runs `task` when a slot is free; resolves with its result. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.pending.push(resolve))
    }
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.pending.shift()?.()
    }
  }

  /** Runs every task with bounded concurrency, preserving input order. */
  async runAll<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    return Promise.all(tasks.map((task) => this.run(task)))
  }

  get activeCount(): number {
    return this.active
  }

  get pendingCount(): number {
    return this.pending.length
  }
}
