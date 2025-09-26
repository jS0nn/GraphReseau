// Minimal shim for Apps Script globals when running outside Apps Script

type GoogleScriptRun = Record<string, (...args: unknown[]) => unknown>

interface GoogleNamespace {
  script?: {
    run?: GoogleScriptRun
  }
}

const win = window as typeof window & { google?: GoogleNamespace }

if(!win.google){
  win.google = {}
}

if(!win.google.script){
  win.google.script = {}
}

if(!win.google.script.run){
  const target: GoogleScriptRun = {}
  win.google.script.run = new Proxy(target, {
    get: (_obj, prop) => {
      return (..._args: unknown[]) => {
        console.warn(`[shim] google.script.run.${String(prop)} called outside Apps Script`)
      }
    },
  })
}

export {}
