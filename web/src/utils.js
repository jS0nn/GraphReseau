export const genId = (p='id') => `${p}-${Math.random().toString(36).slice(2,8)}`
export const valOrNull = (v) => (v === '' || v === undefined ? null : v)
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

