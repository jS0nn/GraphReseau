// Polyfills / defensive helpers for browser compatibility

type CSSWithEscape = {
  escape?: (value: unknown) => string
  [key: string]: unknown
}

const win = window as typeof window & { CSS?: CSSWithEscape }

const ensureEscape = (target: CSSWithEscape): void => {
  if(typeof target.escape === 'function') return
  target.escape = (value: unknown): string => {
    const s = String(value)
    return s.replace(/[^a-zA-Z0-9_\-]/g, (ch) => `\\${ch}`)
  }
}

if(win.CSS){
  ensureEscape(win.CSS as CSSWithEscape)
}else{
  const shim: CSSWithEscape = {}
  ensureEscape(shim)
  Object.defineProperty(win, 'CSS', {
    configurable: true,
    writable: true,
    value: shim,
  })
}

export {}
