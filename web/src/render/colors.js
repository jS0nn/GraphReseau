export function cssVar(name, fallback=''){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  return v?.trim() || fallback
}

export const colors = {
  edge: () => cssVar('--edge-color', '#9fb7e8'),
  edgeSel: () => cssVar('--edge-color-sel', '#d5e6ff'),
}

