import { describe, expect, it } from 'vitest'

import { TaskQueue } from '@main/core/queue'

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('TaskQueue', () => {
  it('never runs more than the configured number of tasks at once', async () => {
    const queue = new TaskQueue(3)
    let running = 0
    let peak = 0

    await queue.runAll(
      Array.from({ length: 20 }, () => async () => {
        running += 1
        peak = Math.max(peak, running)
        await tick(5)
        running -= 1
      }),
    )

    expect(peak).toBe(3)
  })

  it('preserves input order in the results', async () => {
    const queue = new TaskQueue(4)
    const results = await queue.runAll(
      [30, 5, 20, 1].map((delay) => async () => {
        await tick(delay)
        return delay
      }),
    )
    expect(results).toEqual([30, 5, 20, 1])
  })

  it('frees the slot when a task throws, so the queue does not deadlock', async () => {
    const queue = new TaskQueue(1)

    await expect(
      queue.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // If the failing task had not released its slot, this would hang.
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok')
    expect(queue.activeCount).toBe(0)
    expect(queue.pendingCount).toBe(0)
  })

  it('rejects a nonsensical limit', () => {
    expect(() => new TaskQueue(0)).toThrow()
  })
})
