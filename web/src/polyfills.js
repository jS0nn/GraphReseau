// Polyfills / defensive helpers for browser compatibility

// CSS.escape fallback (Safari/older browsers)
if (!window.CSS) window.CSS = {}
if (typeof window.CSS.escape !== 'function') {
  window.CSS.escape = function (value) {
    const s = String(value)
    return s.replace(/[^a-zA-Z0-9_\-]/g, ch => `\\${ch}`)
  }
}

