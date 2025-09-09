// History manager: snapshot/undo/redo

export function createHistory(getSnapshot, applySnapshot){
  const stack = []
  let idx = -1

  function push(label=''){ 
    const snap = getSnapshot()
    // Truncate forward history and push
    stack.splice(idx+1)
    stack.push({ label, state: snap })
    idx = stack.length - 1
  }

  function canUndo(){ return idx > 0 }
  function canRedo(){ return idx >= 0 && idx < stack.length - 1 }

  function undo(){ if(!canUndo()) return null; idx -= 1; const s = stack[idx]?.state; if(s) applySnapshot(s); return s }
  function redo(){ if(!canRedo()) return null; idx += 1; const s = stack[idx]?.state; if(s) applySnapshot(s); return s }

  function reset(){ stack.length = 0; idx = -1 }

  return { push, undo, redo, canUndo, canRedo, reset }
}

