export function cssVar(name: string, fallback = ''): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  const trimmed = typeof v === 'string' ? v.trim() : ''
  return trimmed || fallback
}

export const colors = {
  edge: (): string => cssVar('--edge-color', '#9fb7e8'),
  edgeSel: (): string => cssVar('--edge-color-sel', '#d5e6ff'),
}
