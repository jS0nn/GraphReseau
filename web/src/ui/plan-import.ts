import { uploadPlanOverlayFile } from '../api.ts'
import { getMap } from '../map.ts'
import type { PlanOverlayBounds } from '../types/plan-overlay.ts'
import { log } from './logs.ts'

type PlanImportOptions = {
  trigger: HTMLButtonElement | null
  onPlanImported?: () => Promise<void> | void
  setStatus?: (message: string) => void
}

export function initPlanImportUI(options: PlanImportOptions): void {
  const dialog = document.getElementById('planImportDialog') as HTMLDialogElement | null
  const dropZone = document.getElementById('planImportDrop') as HTMLElement | null
  const fileInput = document.getElementById('planImportFile') as HTMLInputElement | null
  const detailsEl = document.getElementById('planImportDetails') as HTMLElement | null
  const statusEl = document.getElementById('planImportStatus') as HTMLElement | null
  const submitBtn = document.getElementById('planImportSubmit') as HTMLButtonElement | null
  const closeBtn = document.getElementById('planImportClose') as HTMLButtonElement | null

  if(!dialog || !dropZone || !fileInput || !detailsEl || !statusEl || !submitBtn || !closeBtn){
    return
  }

  let selectedFile: File | null = null
  let busy = false

  function setStatus(message: string | null, variant: 'normal' | 'error' | 'success' = 'normal'): void {
    statusEl.textContent = message || ''
    statusEl.classList.remove('error', 'success')
    if(variant !== 'normal') statusEl.classList.add(variant)
    if(options.setStatus){
      options.setStatus(message || '')
    }
  }

  function setBusy(flag: boolean): void {
    busy = flag
    dialog.classList.toggle('loading', flag)
    submitBtn.disabled = flag || !selectedFile
    fileInput.disabled = flag
  }

  function reset(): void {
    selectedFile = null
    fileInput.value = ''
    submitBtn.disabled = true
    setStatus(null)
    updateDetails()
  }

  function updateDetails(): void {
    if(!selectedFile){
      detailsEl.textContent = 'Aucun fichier sélectionné.'
      return
    }
    const sizeMB = (selectedFile.size / (1024 * 1024)).toFixed(2)
    detailsEl.textContent = `${selectedFile.name} · ${sizeMB} Mo`
  }

  async function handleSubmit(): Promise<void> {
    if(!selectedFile || busy) return
    const maxBytes = 20 * 1024 * 1024
    if(selectedFile.size > maxBytes){
      setStatus('Le fichier dépasse la limite de 20 Mo.', 'error')
      return
    }
    setBusy(true)
    setStatus(`Importation de « ${selectedFile.name} »…`)
    try{
    let bounds: PlanOverlayBounds | undefined
    try{
      const map = getMap()
      const b = map?.getBounds()
      if(b){
        bounds = {
          sw: { lat: b.getSouth(), lon: b.getWest() },
          se: { lat: b.getSouth(), lon: b.getEast() },
          nw: { lat: b.getNorth(), lon: b.getWest() },
          ne: { lat: b.getNorth(), lon: b.getEast() },
        }
      }
    }catch{}

    await uploadPlanOverlayFile(selectedFile, { displayName: selectedFile.name, bounds })
      log(`Plan importé: ${selectedFile.name}`)
      setStatus('Plan importé avec succès.', 'success')
      if(options.onPlanImported){
        await options.onPlanImported()
      }
      if('close' in dialog){
        dialog.close()
      }else{
        dialog.removeAttribute('open')
      }
      reset()
    }catch(err){
      console.error('[plan-import] upload failed', err)
      const message = err instanceof Error ? err.message : String(err)
      setStatus(`Erreur import plan: ${message}`, 'error')
    }finally{
      setBusy(false)
    }
  }

  function openDialog(): void {
    reset()
    try{
      if('showModal' in dialog){
        dialog.showModal()
      }else{
        dialog.setAttribute('open', 'true')
      }
    }catch{
      dialog.setAttribute('open', 'true')
    }
  }

  fileInput.addEventListener('change', () => {
    selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null
    setStatus(null)
    updateDetails()
    submitBtn.disabled = busy || !selectedFile
  })

  submitBtn.addEventListener('click', () => {
    if(!selectedFile){
      setStatus('Sélectionnez un fichier PDF ou PNG avant d’importer.', 'error')
      return
    }
    void handleSubmit()
  })

  closeBtn.addEventListener('click', () => {
    if('close' in dialog){
      dialog.close()
    }else{
      dialog.removeAttribute('open')
    }
    reset()
  })

  dialog.addEventListener('cancel', () => {
    reset()
    if('close' in dialog){
      dialog.close()
    }else{
      dialog.removeAttribute('open')
    }
  })

  ;['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault()
      dropZone.classList.add('dragging')
    })
  })
  ;['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault()
      dropZone.classList.remove('dragging')
    })
  })
  dropZone.addEventListener('drop', (event) => {
    const dragEvent = event as DragEvent
    const files = dragEvent.dataTransfer?.files
    if(files && files[0]){
      fileInput.files = files
      fileInput.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })

  dropZone.addEventListener('click', () => {
    fileInput.click()
  })

  if(options.trigger){
    const trigger = options.trigger
    trigger.addEventListener('click', (event) => {
      event.preventDefault()
      openDialog()
    })
  }
}
