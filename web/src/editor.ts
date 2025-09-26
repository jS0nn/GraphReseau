// Entry point: load modular editor bundle and trigger the boot helper

export {}

type EditorBootModule = {
  boot?: () => void
}

declare global {
  interface Window {
    EditorBoot?: EditorBootModule
  }
}

const loadScript = (src: string): Promise<void> => new Promise((resolve, reject) => {
  const script = document.createElement('script')
  script.src = src
  script.defer = true
  script.onload = () => resolve()
  script.onerror = (event) => reject(event)
  document.head.appendChild(script)
})

loadScript('/static/bundle/editor.boot.js')
  .then(() => {
    if(window.EditorBoot?.boot){
      try{
        window.EditorBoot.boot()
      }catch(err){
        console.error('Editor boot failed', err)
      }
    }
  })
  .catch(err => {
    console.error('Failed to load editor.boot', err)
  })
