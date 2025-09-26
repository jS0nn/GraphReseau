import test from 'node:test'
import assert from 'node:assert/strict'

import { createHistory } from '../src/state/history.ts'

test('history push and undo/redo cycle works', () => {
  const snapshots: Array<{ value: number }> = []
  let current = { value: 0 }

  const history = createHistory(
    () => ({ ...current }),
    (next) => { current = { ...next }; snapshots.push(next) },
  )

  history.push('initial')
  current.value = 1
  history.push('update-1')
  current.value = 2
  history.push('update-2')

  assert.equal(history.canUndo(), true)
  assert.equal(history.canRedo(), false)

  const undo1 = history.undo()
  assert.equal(undo1?.value, 1)
  assert.equal(current.value, 1)

  const undo2 = history.undo()
  assert.equal(undo2?.value, 0)
  assert.equal(current.value, 0)
  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), true)

  const redo1 = history.redo()
  assert.equal(redo1?.value, 1)
  assert.equal(current.value, 1)

  const redo2 = history.redo()
  assert.equal(redo2?.value, 2)
  assert.equal(current.value, 2)
  assert.equal(history.canRedo(), false)

  history.reset()
  assert.equal(history.canUndo(), false)
  assert.equal(history.canRedo(), false)
  assert.deepEqual(snapshots.map((s) => s.value), [1, 0, 1, 2])
})
