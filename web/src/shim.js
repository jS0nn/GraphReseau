// Minimal shim for Apps Script globals when running outside Apps Script
if (!window.google) window.google = {}
if (!window.google.script) window.google.script = {}
if (!window.google.script.run) {
  window.google.script.run = new Proxy({}, {
    get() {
      return (..._args) => console.warn('[shim] google.script.run called outside Apps Script')
    }
  })
}

