import { displayXYForNode } from '../geo.js'
import { NODE_SIZE } from '../constants/nodes.js'
import { state, getViewMode, subscribe } from '../state/index.js'

let cachedLayout = null
let layoutDirty = true

const DEFAULT_COLUMN_GAP = 190
const DEFAULT_LEVEL_GAP = 180
const DEFAULT_GRID_GAP = 140
const MIN_COLUMN_GAP = 130
const MAX_COLUMN_GAP = 210
const HORIZONTAL_SPACING_FACTOR = 1.1
const MIN_LEVEL_GAP = 100
const MAX_LEVEL_GAP = 200
const MIN_GRID_GAP = 110
const MAX_GRID_GAP = 160
const LEFT_MARGIN = 60
const TOP_MARGIN = 60
const BOTTOM_MARGIN = 80
const LEFT_COLUMN_WIDTH = 280

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function byName(aNode, bNode){
  const a = (aNode?.name || aNode?.id || '').toString().toLowerCase()
  const b = (bNode?.name || bNode?.id || '').toString().toLowerCase()
  if(a < b) return -1
  if(a > b) return 1
  return 0
}

function sortIds(ids, lookup){
  return ids.slice().sort((A, B) => byName(lookup.get(A), lookup.get(B)))
}

function ensureLayout(){
  if(!layoutDirty && cachedLayout) return cachedLayout
  cachedLayout = computeGraphLayout(state.nodes, state.edges)
  layoutDirty = false
  return cachedLayout
}

function computeGraphLayout(nodes, edges){
  const lookup = new Map()
  nodes.forEach(n => { if(n && n.id) lookup.set(n.id, n) })
  const adjacency = new Map()
  const reverseAdj = new Map()
  const indegree = new Map()
  const degree = new Map()
  lookup.forEach((_, id)=>{
    adjacency.set(id, new Set())
    reverseAdj.set(id, new Set())
    indegree.set(id, 0)
    degree.set(id, 0)
  })

  for(const edge of edges || []){
    if(!edge) continue
    const from = edge.source ?? edge.from_id
    const to = edge.target ?? edge.to_id
    if(!lookup.has(from) || !lookup.has(to)) continue
    adjacency.get(from).add(to)
    reverseAdj.get(to).add(from)
    degree.set(from, (degree.get(from) || 0) + 1)
    degree.set(to, (degree.get(to) || 0) + 1)
    indegree.set(to, (indegree.get(to) || 0) + 1)
    if(!indegree.has(from)) indegree.set(from, 0)
  }

  const generalNodes = nodes.filter(n => String(n?.type || '').toUpperCase() === 'GENERAL')
  const generalIds = generalNodes.map(n => n.id).filter(Boolean)
  const generalSet = new Set(generalIds)

  let generalOutgoing = 0
  let generalIncoming = 0
  for(const edge of edges || []){
    if(!edge) continue
    const from = edge.source ?? edge.from_id
    const to = edge.target ?? edge.to_id
    if(!lookup.has(from) || !lookup.has(to)) continue
    if(generalSet.has(from)) generalOutgoing += 1
    if(generalSet.has(to)) generalIncoming += 1
  }

  const countReachable = (graphMap, seeds) => {
    const visited = new Set()
    const queue = []
    for(const id of seeds){
      if(!lookup.has(id) || visited.has(id)) continue
      visited.add(id)
      queue.push(id)
    }
    while(queue.length){
      const current = queue.shift()
      const neighbors = graphMap.get(current)
      if(!neighbors) continue
      neighbors.forEach(nb => {
        if(!lookup.has(nb) || visited.has(nb)) return
        visited.add(nb)
        queue.push(nb)
      })
    }
    return visited.size
  }

  let traverseForward = true
  if(generalSet.size){
    if(generalIncoming > generalOutgoing){
      traverseForward = false
    }else if(generalIncoming === generalOutgoing){
      const forwardCoverage = countReachable(adjacency, generalIds)
      const reverseCoverage = countReachable(reverseAdj, generalIds)
      if(reverseCoverage > forwardCoverage) traverseForward = false
    }
  }

  const childMap = traverseForward ? adjacency : reverseAdj
  const parentMap = traverseForward ? reverseAdj : adjacency

  const stageDist = new Map()
  const queue = []
  for(const node of generalNodes){
    if(!node?.id) continue
    if(!stageDist.has(node.id)){
      stageDist.set(node.id, 0)
      queue.push(node.id)
    }
  }
  const seenInStage = new Set(queue)
  while(queue.length){
    const id = queue.shift()
    const depth = stageDist.get(id) ?? 0
    const nextDepth = depth + 1
    const children = childMap.get(id) || new Set()
    for(const child of children){
      if(!lookup.has(child)) continue
      const prev = stageDist.get(child)
      if(prev == null || nextDepth < prev){
        stageDist.set(child, nextDepth)
        if(!seenInStage.has(child)){
          queue.push(child)
          seenInStage.add(child)
        }
      }
    }
  }

  const unassigned = []
  const treeCandidates = []
  lookup.forEach((node, id)=>{
    const type = String(node?.type || '').toUpperCase()
    const deg = degree.get(id) || 0
    if(deg === 0 && type !== 'GENERAL') unassigned.push(node)
    else treeCandidates.push(node)
  })

  const visited = new Set()
  const components = []

  function bfsFromRoots(rootIds){
    const queue = []
    const localDepth = new Map()
    const localLevels = new Map()
    const localOrder = []

    const sortedRoots = sortIds(rootIds.filter(id => lookup.has(id)), lookup)
    for(const id of sortedRoots){
      if(visited.has(id)) continue
      queue.push(id)
      visited.add(id)
      localDepth.set(id, 0)
    }

    while(queue.length){
      const id = queue.shift()
      const depth = localDepth.get(id) || 0
      localOrder.push(id)
      if(!localLevels.has(depth)) localLevels.set(depth, [])
      const levelArr = localLevels.get(depth)
      if(!levelArr.includes(id)) levelArr.push(id)
      const neighbors = sortIds(Array.from(childMap.get(id) || []), lookup)
      for(const nb of neighbors){
        if(!lookup.has(nb)) continue
        const nextDepth = depth + 1
        if(!localDepth.has(nb) || nextDepth < localDepth.get(nb)){
          localDepth.set(nb, nextDepth)
        }
        if(!visited.has(nb)){
          visited.add(nb)
          queue.push(nb)
        }
      }
    }

    if(localOrder.length){
      let maxDepth = 0
      localDepth.forEach(d => { if(d > maxDepth) maxDepth = d })
      components.push({ order: localOrder, levels: localLevels, depth: localDepth, maxDepth })
    }
  }

  const generalRoots = nodes.filter(n => String(n?.type || '').toUpperCase() === 'GENERAL').map(n => n.id)
  if(generalRoots.length){ bfsFromRoots(generalRoots) }

  // Remaining nodes with edges (degree>0) that were not visited yet → separate components
  const fallbackRoots = sortIds(treeCandidates.map(n => n.id), lookup)
  for(const id of fallbackRoots){
    if(visited.has(id)) continue
    const deg = degree.get(id) || 0
    if(deg === 0) continue
    bfsFromRoots([id])
  }

  // In case everything was unassigned, still keep GENERAL nodes visible
  if(!components.length){
    const onlyGenerals = sortIds(generalRoots, lookup)
    if(onlyGenerals.length){
      components.push({
        order: onlyGenerals,
        levels: new Map([[0, onlyGenerals]]),
        depth: new Map(onlyGenerals.map(id => [id, 0])),
        maxDepth: 0,
      })
    }
  }

  const globalDepth = new Map()
  const globalLevels = new Map()
  let depthOffset = 0
  for(const comp of components){
    const offset = depthOffset
    comp.levels.forEach((ids, localDepth)=>{
      const depth = localDepth + offset
      if(!globalLevels.has(depth)) globalLevels.set(depth, [])
      const arr = globalLevels.get(depth)
      for(const id of ids){
        if(!arr.includes(id)) arr.push(id)
        globalDepth.set(id, depth)
      }
    })
    depthOffset += comp.maxDepth + 2
  }

  const depthKeys = Array.from(globalLevels.keys())
  const maxDepth = depthKeys.length ? Math.max(...depthKeys) : 0
  const levelCount = depthKeys.length ? maxDepth + 1 : 1
  const maxPerLevel = depthKeys.length ? Math.max(...Array.from(globalLevels.values(), arr => arr.length || 0)) : 0

  const canvasEl = typeof document !== 'undefined' ? document.getElementById('canvas') : null
  const canvasWidth = canvasEl?.clientWidth || 1400
  const canvasHeight = canvasEl?.clientHeight || 900

  let gridCols = 0
  let gridRows = 0
  let gridGap = DEFAULT_GRID_GAP
  if(unassigned.length){
    gridCols = Math.max(1, Math.ceil(Math.sqrt(unassigned.length)))
    gridRows = Math.ceil(unassigned.length / gridCols)
    if(gridCols > 1){
      gridGap = clamp((LEFT_COLUMN_WIDTH - NODE_SIZE.w) / (gridCols - 1), MIN_GRID_GAP, MAX_GRID_GAP)
    }
  }

  let leftBlock = unassigned.length ? LEFT_COLUMN_WIDTH : 0
  if(unassigned.length){
    const requiredWidth = (gridCols - 1) * gridGap + NODE_SIZE.w
    leftBlock = Math.max(LEFT_COLUMN_WIDTH, requiredWidth + 80)
    if(gridCols > 1){
      gridGap = clamp((leftBlock - 80 - NODE_SIZE.w) / (gridCols - 1), MIN_GRID_GAP, MAX_GRID_GAP)
    }
  }

  const availableWidth = Math.max(320, canvasWidth - leftBlock - (2 * LEFT_MARGIN))
  const availableHeight = Math.max(240, canvasHeight - TOP_MARGIN - BOTTOM_MARGIN)

  const levelGap = levelCount > 1 ? clamp(availableHeight / Math.max(1, levelCount - 1), MIN_LEVEL_GAP, MAX_LEVEL_GAP) : DEFAULT_LEVEL_GAP
  const centerX = LEFT_MARGIN + leftBlock + availableWidth / 2

  const treeSpanHeight = levelCount > 1 ? (levelCount - 1) * levelGap : 0
  const baseY = TOP_MARGIN + Math.max(0, (availableHeight - treeSpanHeight) / 2)

  const positions = new Map()
  const areaLeft = LEFT_MARGIN + leftBlock
  const areaRight = areaLeft + availableWidth

  const toPos = (id, px, py) => {
    const node = lookup.get(id)
    if(node && String(node.type || '').toUpperCase() === 'JONCTION'){
      positions.set(id, { x: px + NODE_SIZE.w / 2, y: py + NODE_SIZE.h / 2 })
    }else{
      positions.set(id, { x: px, y: py })
    }
  }

  const depthFallback = (id) => {
    if(stageDist.has(id)) return stageDist.get(id)
    if(globalDepth.has(id)) return globalDepth.get(id)
    return 0
  }

  const primaryParent = new Map()
  lookup.forEach((node, id)=>{
    if(String(node?.type || '').toUpperCase() === 'GENERAL') return
    const parents = Array.from(parentMap.get(id) || [])
      .filter(pid => pid !== id && lookup.has(pid))
    if(!parents.length) return
    const childStage = stageDist.get(id)
    let candidates = parents
    if(childStage != null){
      const exact = parents.filter(pid => (stageDist.get(pid) ?? depthFallback(pid)) === childStage - 1)
      if(exact.length) candidates = exact
    }
    candidates.sort((a,b)=>{
      const da = depthFallback(a)
      const db = depthFallback(b)
      if(da !== db) return da - db
      if(a === b) return 0
      return byName(lookup.get(a), lookup.get(b))
    })
    primaryParent.set(id, candidates[0])
  })

  const treeChildren = new Map()
  lookup.forEach((_, id)=>{ treeChildren.set(id, []) })
  primaryParent.forEach((parent, child)=>{
    if(treeChildren.has(parent)) treeChildren.get(parent).push(child)
  })
  treeChildren.forEach((list, id)=>{
    if(list.length) list.sort((a,b)=>byName(lookup.get(a), lookup.get(b)))
    else treeChildren.delete(id)
  })

  const nodeUnit = new Map()
  const nodeDepthFinal = new Map()
  let nextLeaf = 0
  const visiting = new Set()

  const dfs = (nodeId, depth = 0) => {
    const currentDepth = nodeDepthFinal.get(nodeId)
    if(currentDepth == null || depth > currentDepth) nodeDepthFinal.set(nodeId, depth)
    if(nodeUnit.has(nodeId)){
      visiting.delete(nodeId)
      return nodeUnit.get(nodeId)
    }
    if(visiting.has(nodeId)){
      return nodeUnit.get(nodeId) ?? nextLeaf
    }
    visiting.add(nodeId)
    const children = treeChildren.get(nodeId) || []
    if(!children.length){
      const pos = nodeUnit.get(nodeId) ?? nextLeaf
      if(!nodeUnit.has(nodeId)) nodeUnit.set(nodeId, pos)
      nextLeaf = Math.max(nextLeaf, pos + 1)
      visiting.delete(nodeId)
      return nodeUnit.get(nodeId)
    }
    let min = Infinity
    let max = -Infinity
    for(const child of children){
      const intendedDepth = stageDist.has(child) ? Math.max(stageDist.get(child), depth + 1) : (depth + 1)
      const childPos = dfs(child, intendedDepth)
      if(childPos < min) min = childPos
      if(childPos > max) max = childPos
    }
    if(!isFinite(min) || !isFinite(max)){
      const fallback = nodeUnit.get(nodeId) ?? nextLeaf
      nodeUnit.set(nodeId, fallback)
      nextLeaf = Math.max(nextLeaf, fallback + 1)
      visiting.delete(nodeId)
      return fallback
    }
    const mid = (min + max) / 2
    nodeUnit.set(nodeId, mid)
    visiting.delete(nodeId)
    return mid
  }

  const roots = []
  lookup.forEach((node, id)=>{
    const type = String(node?.type || '').toUpperCase()
    const deg = degree.get(id) || 0
    if(deg === 0 && type !== 'GENERAL') return
    if(!primaryParent.has(id)) roots.push(id)
  })
  roots.sort((a,b)=>{
    const da = stageDist.get(a) ?? (globalDepth.get(a) ?? 0)
    const db = stageDist.get(b) ?? (globalDepth.get(b) ?? 0)
    if(da !== db) return da - db
    return byName(lookup.get(a), lookup.get(b))
  })
  roots.forEach(id => dfs(id, stageDist.get(id) ?? 0))
  // Ensure remaining nodes with parents still get a position
  treeChildren.forEach((_, id)=>{
    if(nodeUnit.has(id)) return
    const depth = stageDist.get(id) ?? nodeDepthFinal.get(id) ?? (globalDepth.get(id) ?? 0)
    dfs(id, depth)
  })

  let minUnit = Infinity
  let maxUnit = -Infinity
  nodeUnit.forEach(pos => {
    if(pos < minUnit) minUnit = pos
    if(pos > maxUnit) maxUnit = pos
  })
  if(!isFinite(minUnit)) minUnit = 0
  if(!isFinite(maxUnit)) maxUnit = minUnit
  const spanUnits = Math.max(0.0001, maxUnit - minUnit)
  let unitGap = spanUnits > 0 ? clamp(availableWidth / spanUnits, MIN_COLUMN_GAP, MAX_COLUMN_GAP) : DEFAULT_COLUMN_GAP
  if(!isFinite(unitGap) || unitGap <= 0) unitGap = DEFAULT_COLUMN_GAP
  unitGap = clamp(unitGap * HORIZONTAL_SPACING_FACTOR, MIN_COLUMN_GAP, MAX_COLUMN_GAP * HORIZONTAL_SPACING_FACTOR)
  const totalSpan = (maxUnit - minUnit) * unitGap
  const offset = areaLeft + Math.max(0, (availableWidth - totalSpan) / 2) - (minUnit * unitGap)

  nodeUnit.forEach((pos, id)=>{
    const depth = nodeDepthFinal.get(id) ?? globalDepth.get(id) ?? 0
    const x = Math.round(offset + pos * unitGap)
    const y = Math.round(baseY + depth * levelGap)
    toPos(id, x, y)
  })

  if(unassigned.length){
    const sorted = unassigned.slice().sort(byName)
    const gridWidth = (gridCols - 1) * gridGap + NODE_SIZE.w
    const gridHeight = gridRows > 0 ? (gridRows - 1) * gridGap + NODE_SIZE.h : 0
    const gridStartX = LEFT_MARGIN + Math.max(0, (leftBlock - gridWidth) / 2)
    const gridStartY = TOP_MARGIN + Math.max(0, (availableHeight - gridHeight) / 2)
    sorted.forEach((node, idx)=>{
      const row = Math.floor(idx / gridCols)
      const col = idx % gridCols
      const x = Math.round(gridStartX + col * gridGap)
      const y = Math.round(gridStartY + row * gridGap)
      toPos(node.id, x, y)
    })
  }

  // Fallback: ensure every node has at least a position
  const fallbackX = Math.round(centerX)
  const fallbackY = Math.round(baseY)
  nodes.forEach(node => {
    if(!node?.id) return
    if(!positions.has(node.id)){
      const type = String(node.type || '').toUpperCase()
      const defaultX = type === 'GENERAL' ? fallbackX : areaLeft
      toPos(node.id, defaultX, fallbackY)
    }
  })

  return {
    positions,
    meta: {
      unassigned: unassigned.map(n => n.id),
      maxDepth,
      levelCount,
      gridCols,
      gridRows,
      orientation: 'vertical',
    },
  }
}

export function invalidateViewLayout(){
  layoutDirty = true
}

export function isGraphView(){
  return getViewMode() === 'graph'
}

export function getNodeCanvasPosition(node){
  if(isGraphView()){
    const layout = ensureLayout()
    if(node?.id && layout.positions.has(node.id)){
      return layout.positions.get(node.id)
    }
  }
  return displayXYForNode(node)
}

export function getGraphLayoutMeta(){
  if(!isGraphView()) return null
  return ensureLayout().meta
}

export function getNodeCenterPosition(node){
  const pos = getNodeCanvasPosition(node)
  const type = String(node?.type || '').toUpperCase()
  if(type === 'JONCTION') return { x: pos.x || 0, y: pos.y || 0 }
  return {
    x: (pos.x || 0) + NODE_SIZE.w / 2,
    y: (pos.y || 0) + NODE_SIZE.h / 2,
  }
}

subscribe((evt)=>{
  if(evt === 'graph:set' || evt.startsWith('node:') || evt.startsWith('edge:') || evt === 'sequence:update' || evt === 'view:set'){
    invalidateViewLayout()
  }
})
