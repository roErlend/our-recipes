import { afterEach, describe, expect, it } from 'vitest'

import {
  enqueueOp,
  flushOutbox,
  getOutboxSnapshot,
  type OutboxOp,
} from '@/lib/offline'

// jsdom has no IndexedDB, so the idb writes are best-effort no-ops; the in-memory
// outbox (the optimistic overlay + queue) still behaves exactly as in the browser.
// Drain after each test to isolate the shared module state.
afterEach(async () => {
  await flushOutbox(async () => {})
})

const ids = () => getOutboxSnapshot().map((o) => o.id)
const find = (id: string) => getOutboxSnapshot().find((o) => o.id === id)

describe('enqueueOp', () => {
  it('coalesces repeated ops for the same item, keeping the latest value', () => {
    enqueueOp({ type: 'check', key: 'a', value: true })
    enqueueOp({ type: 'check', key: 'a', value: false })

    const checks = getOutboxSnapshot().filter((o) => o.id === 'check:a')
    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ type: 'check', key: 'a', value: false })
  })

  it('keeps a check and a quantity for the same item as separate ops', () => {
    enqueueOp({ type: 'check', key: 'a', value: true })
    enqueueOp({ type: 'quantity', key: 'a', value: 3 })

    expect(ids().sort()).toEqual(['check:a', 'quantity:a'])
  })
})

describe('flushOutbox', () => {
  it('replays every queued op and drains on success', async () => {
    enqueueOp({ type: 'check', key: 'a', value: true })
    enqueueOp({ type: 'quantity', key: 'b', value: 2 })

    const seen: OutboxOp[] = []
    await flushOutbox(async (op) => {
      seen.push(op)
    })

    expect(seen).toHaveLength(2)
    expect(getOutboxSnapshot()).toEqual([])
  })

  it('stops at the first failure and keeps the rest queued', async () => {
    enqueueOp({ type: 'check', key: 'a', value: true })
    enqueueOp({ type: 'check', key: 'b', value: true })

    await flushOutbox(async (op) => {
      if (op.key === 'b') throw new Error('offline')
    })

    // 'a' (older) succeeded and was dropped; 'b' failed and remains.
    expect(ids()).toEqual(['check:b'])
  })

  it('does not drop an op that was re-toggled while it was in flight', async () => {
    enqueueOp({ type: 'check', key: 'a', value: true })

    await flushOutbox(async () => {
      // Simulate the user re-toggling during the (async) server call.
      enqueueOp({ type: 'check', key: 'a', value: false })
    })

    // The newer value must survive — it hasn't been sent yet.
    expect(find('check:a')).toMatchObject({ value: false })
  })
})
