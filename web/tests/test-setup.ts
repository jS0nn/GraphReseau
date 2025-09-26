const g = globalThis as typeof globalThis

if(typeof g.window === 'undefined'){
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()

  const dispatchEvent = (type: string, event: Event) => {
    const set = listeners.get(type)
    if(!set) return
    for(const handler of set){
      if(typeof handler === 'function') handler.call(windowStub, event)
      else if(typeof handler === 'object' && typeof handler.handleEvent === 'function') handler.handleEvent(event)
    }
  }

  const addEventListener = (type: string, handler: EventListenerOrEventListenerObject) => {
    if(!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)?.add(handler)
  }

  const removeEventListener = (type: string, handler: EventListenerOrEventListenerObject) => {
    listeners.get(type)?.delete(handler)
  }

  const raf = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(Date.now()), 16) as unknown as number
  }

  const caf = (id: number): void => {
    clearTimeout(id)
  }

  const createElement = (tagName: string) => {
    const element: any = {
      tagName,
      style: {},
      children: [] as unknown[],
      appendChild(child: unknown){ this.children.push(child); return child },
      removeChild(child: unknown){ this.children = this.children.filter((existing: unknown) => existing !== child) },
      setAttribute(){},
      getContext(){ return null },
      getBoundingClientRect(){ return { left: 0, top: 0, width: 0, height: 0 } },
      addEventListener(){},
      removeEventListener(){},
      querySelector(){ return null },
      querySelectorAll(){ return [] },
    }
    return element
  }

  const body = {
    style: {},
    appendChild(){},
    removeChild(){},
    classList: { add(){}, remove(){} },
    dataset: Object.create(null),
  }

  const documentStub = {
    body,
    documentElement: { style: {}, dataset: Object.create(null) },
    createElement,
    createElementNS: (_ns: string, tagName: string) => createElement(tagName),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [] as Element[],
    addEventListener,
    removeEventListener,
  } as unknown as Document

  const windowStub = {
    document: documentStub,
    navigator: { userAgent: 'node', platform: 'node' } as Navigator,
    devicePixelRatio: 1,
    innerWidth: 1024,
    innerHeight: 768,
    matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){} }),
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    addEventListener,
    removeEventListener,
    dispatchEvent,
    performance: globalThis.performance,
    name: '',
  } as unknown as Window & typeof globalThis

  windowStub.window = windowStub

  Object.defineProperty(g, 'window', { value: windowStub, configurable: true })
  Object.defineProperty(g, 'document', { value: documentStub, configurable: true })
  Object.defineProperty(g, 'navigator', { value: windowStub.navigator, configurable: true })
  Object.defineProperty(g, 'requestAnimationFrame', { value: raf, configurable: true })
  Object.defineProperty(g, 'cancelAnimationFrame', { value: caf, configurable: true })

  if(typeof (globalThis as any).HTMLElement === 'undefined'){
    class HTMLElementStub {}
    ;(globalThis as any).HTMLElement = HTMLElementStub
    ;(globalThis as any).HTMLDivElement = HTMLElementStub
    ;(globalThis as any).SVGElement = HTMLElementStub
  }
}
