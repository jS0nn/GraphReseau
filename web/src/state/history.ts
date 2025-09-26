// History manager: snapshot/undo/redo

export interface HistoryEntry<TSnapshot> {
  label: string
  state: TSnapshot
}

export interface HistoryController<TSnapshot> {
  push: (label?: string) => void
  undo: () => TSnapshot | null
  redo: () => TSnapshot | null
  canUndo: () => boolean
  canRedo: () => boolean
  reset: () => void
}

export function createHistory<TSnapshot>(
  getSnapshot: () => TSnapshot,
  applySnapshot: (snapshot: TSnapshot) => void,
): HistoryController<TSnapshot> {
  const stack: HistoryEntry<TSnapshot>[] = []
  let idx = -1

  function push(label = ''): void {
    const snap = getSnapshot()
    // Truncate forward history and push
    stack.splice(idx + 1)
    stack.push({ label, state: snap })
    idx = stack.length - 1
  }

  function canUndo(): boolean { return idx > 0 }
  function canRedo(): boolean { return idx >= 0 && idx < stack.length - 1 }

  function undo(): TSnapshot | null {
    if(!canUndo()) return null
    idx -= 1
    const entry = stack[idx]
    if(!entry) return null
    applySnapshot(entry.state)
    return entry.state
  }

  function redo(): TSnapshot | null {
    if(!canRedo()) return null
    idx += 1
    const entry = stack[idx]
    if(!entry) return null
    applySnapshot(entry.state)
    return entry.state
  }

  function reset(): void {
    stack.length = 0
    idx = -1
  }

  return { push, undo, redo, canUndo, canRedo, reset }
}
