const PASS_THROUGH_TYPES = new Set(['VANNE', 'POINT_MESURE'])

const toNumber = (value) => {
  if(value === '' || value === undefined || value === null) return null
  if(typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value).trim().replace(',', '.').replace(/[^0-9.\-]/g, '')
  if(!text) return null
  const parsed = parseFloat(text)
  return Number.isFinite(parsed) ? parsed : null
}

const normalizeNumericValue = (value) => {
  if(value === '' || value === undefined || value === null) return null
  if(typeof value === 'number') return Number.isFinite(value) ? value : null
  if(typeof value === 'string'){
    const norm = value.trim().replace(',', '.').replace(/[^0-9.\-]/g, '')
    const parsed = parseFloat(norm)
    return Number.isFinite(parsed) ? parsed : null
  }
  const parsed = +value
  return Number.isFinite(parsed) ? parsed : null
}

const ensureBranchId = (value, fallback) => {
  const txt = value ? String(value).trim() : ''
  if(txt) return txt
  const fb = fallback ? String(fallback).trim() : ''
  return fb || ''
}

const diameterValue = (edge) => {
  const direct = normalizeNumericValue(edge?.diameter_mm)
  if(direct != null && direct >= 0) return direct
  const fallback = normalizeNumericValue(edge?.ui_diameter_mm)
  if(fallback != null && fallback >= 0) return fallback
  return 0
}

const createdAtValue = (edge) => {
  const raw = edge?.created_at ?? edge?.createdAt
  if(!raw) return Number.MAX_SAFE_INTEGER
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

const nodeCoordinates = (node) => {
  if(!node) return null
  const candidates = [
    [node.x, node.y],
    [node.x_ui, node.y_ui],
    [node.gps_lon, node.gps_lat],
  ]
  for(const [xRaw, yRaw] of candidates){
    const x = toNumber(xRaw)
    const y = toNumber(yRaw)
    if(x != null && y != null) return [x, y]
  }
  return null
}

const geometryPoints = (edge) => {
  const geom = edge?.geometry
  if(!Array.isArray(geom) || geom.length < 2) return null
  const points = []
  for(const point of geom){
    if(Array.isArray(point) && point.length >= 2){
      const x = toNumber(point[0])
      const y = toNumber(point[1])
      if(x != null && y != null) points.push([x, y])
      continue
    }
    if(point && typeof point === 'object'){
      const x = toNumber(point.x ?? point.lon ?? point.lng ?? point.longitude)
      const y = toNumber(point.y ?? point.lat ?? point.latitude)
      if(x != null && y != null) points.push([x, y])
    }
  }
  return points.length >= 2 ? points : null
}

const edgeFromId = (edge) => edge?.from_id ?? edge?.source ?? null
const edgeToId = (edge) => edge?.to_id ?? edge?.target ?? null

const vectorBetween = (originId, targetId, edge, nodeCoords) => {
  if(!originId || !targetId || originId === targetId) return null
  const origin = nodeCoords.get(originId)
  const target = nodeCoords.get(targetId)
  if(origin && target) return [target[0] - origin[0], target[1] - origin[1]]

  const points = geometryPoints(edge)
  if(!points) return null

  if(originId === edgeFromId(edge)){
    const [x0, y0] = points[0]
    const [x1, y1] = points[1]
    return [x1 - x0, y1 - y0]
  }
  if(originId === edgeToId(edge)){
    const last = points.length - 1
    const [x0, y0] = points[last]
    const [x1, y1] = points[last - 1]
    return [x1 - x0, y1 - y0]
  }
  return null
}

const angleDelta = (incomingEdge, candidateEdge, nodeId, nodeCoords) => {
  if(!incomingEdge) return 0
  const downstreamId = edgeToId(incomingEdge)
  const upstreamId = edgeFromId(candidateEdge)
  if(!downstreamId || !upstreamId) return 180
  const vecIn = vectorBetween(nodeId, downstreamId, incomingEdge, nodeCoords)
  const vecOut = vectorBetween(nodeId, upstreamId, candidateEdge, nodeCoords)
  if(!vecIn || !vecOut) return 180
  let diff = Math.abs(Math.atan2(vecIn[1], vecIn[0]) - Math.atan2(vecOut[1], vecOut[0]))
  while(diff > Math.PI){
    diff = Math.abs(diff - 2 * Math.PI)
  }
  return diff * 180 / Math.PI
}

const determineReason = (entries) => {
  if(entries.length <= 1) return 'single_outlet'
  const [first, second] = entries
  if(first.diameter > second.diameter + 1e-6) return 'diameter'
  if(Math.abs(first.diameter - second.diameter) <= 1e-6){
    if(first.depth > second.depth) return 'depth'
    if(first.depth === second.depth){
      if(first.createdAt < second.createdAt) return 'created_at'
      if(Math.abs(first.angle - second.angle) > 1e-3) return 'angle'
    }
  }
  return 'edge_id'
}

export function assignBranchIds(nodes = [], edges = []){
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const incomingEdges = new Map()
  const incidentEdges = new Map()
  const childrenByParent = new Map()

  edges.forEach((edge, index) => {
    const fromId = edgeFromId(edge)
    const toId = edgeToId(edge)
    if(fromId && edge.from_id == null) edge.from_id = fromId
    if(toId && edge.to_id == null) edge.to_id = toId
    if(fromId){
      if(!incidentEdges.has(fromId)) incidentEdges.set(fromId, [])
      incidentEdges.get(fromId).push(edge)
    }
    if(toId){
      if(!incomingEdges.has(toId)) incomingEdges.set(toId, [])
      incomingEdges.get(toId).push(edge)
      if(!incidentEdges.has(toId)) incidentEdges.set(toId, [])
      incidentEdges.get(toId).push(edge)
    }
    if(toId && fromId){
      if(!childrenByParent.has(toId)) childrenByParent.set(toId, [])
      childrenByParent.get(toId).push(fromId)
    }
    if(edge.id == null){
      edge.id = edge.id ?? `EDGE-${index + 1}`
    }
    edge.branch_id = ensureBranchId(edge.branch_id)
  })

  const nodeCoords = new Map()
  nodes.forEach((node) => {
    const coords = nodeCoordinates(node)
    if(coords) nodeCoords.set(node.id, coords)
  })

  const nodeBranch = new Map()
  const edgeBranch = new Map()
  const processedEdgeBranch = new Set()
  const processedNodeBranch = new Set()
  const branchCounters = new Map()
  const branchParents = new Map()

  const depthCache = new Map()
  const visitingDepth = new Set()

  const computeDepth = (nodeId) => {
    if(!nodeId) return 0
    if(depthCache.has(nodeId)) return depthCache.get(nodeId)
    if(visitingDepth.has(nodeId)) return 0
    visitingDepth.add(nodeId)
    const children = childrenByParent.get(nodeId) || []
    let depth = 0
    if(children.length){
      let maxChild = 0
      for(const child of children){
        const value = computeDepth(child)
        if(value > maxChild) maxChild = value
      }
      depth = 1 + maxChild
    }
    visitingDepth.delete(nodeId)
    depthCache.set(nodeId, depth)
    return depth
  }

  nodes.forEach((node) => {
    computeDepth(node.id)
  })

  const setNodeBranch = (nodeId, branchId) => {
    if(!nodeId) return
    const branch = ensureBranchId(branchId, nodeId)
    nodeBranch.set(nodeId, branch)
    const node = nodeById.get(nodeId)
    if(node) node.branch_id = branch
  }

  const setEdgeBranch = (edge, branchId) => {
    const branch = ensureBranchId(branchId, edge.id)
    edgeBranch.set(edge.id, branch)
    edge.branch_id = branch
  }

  const createChildBranch = (parentBranch) => {
    const parent = ensureBranchId(parentBranch) || 'BRANCH'
    const count = (branchCounters.get(parent) || 0) + 1
    branchCounters.set(parent, count)
    const child = `${parent}:${String(count).padStart(3, '0')}`
    if(!branchParents.has(child)) branchParents.set(child, parent)
    return child
  }

  const isSeparator = (nodeId) => {
    const node = nodeById.get(nodeId)
    if(!node) return false
    const type = String(node.type || '').toUpperCase()
    if(PASS_THROUGH_TYPES.has(type)) return false
    if(type === 'JONCTION') return true
    const degree = incidentEdges.get(nodeId)?.length ?? 0
    return degree >= 3
  }

  const selectPrimary = (nodeId, candidates, incomingEdge) => {
    if(!candidates.length) return { edge: null, reason: 'no_candidate', entries: [] }
    const entries = candidates.map((edge) => ({
      edge,
      diameter: diameterValue(edge),
      depth: computeDepth(edgeFromId(edge)) ?? 0,
      createdAt: createdAtValue(edge),
      angle: angleDelta(incomingEdge, edge, nodeId, nodeCoords),
    }))
    entries.sort((a, b) => {
      if(b.diameter !== a.diameter) return b.diameter - a.diameter
      if(b.depth !== a.depth) return b.depth - a.depth
      if(a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
      if(a.angle !== b.angle) return a.angle - b.angle
      const idA = ensureBranchId(a.edge.id)
      const idB = ensureBranchId(b.edge.id)
      return idA.localeCompare(idB)
    })
    const reason = determineReason(entries)
    return { edge: entries[0]?.edge ?? null, reason, entries }
  }

  const assignEdge = (edge, branchId, reason = 'pass_through', parentBranch = null) => {
    if(!edge) return
    const branch = ensureBranchId(branchId, edge.id)
    const key = `${edge.id}|${branch}`
    if(processedEdgeBranch.has(key)) return
    processedEdgeBranch.add(key)
    setEdgeBranch(edge, branch)
    if(parentBranch){
      const parent = ensureBranchId(parentBranch)
      if(parent) branchParents.set(branch, parent)
    }
    assignFromNode(edgeFromId(edge), branch, edge)
  }

  const assignFromNode = (nodeId, branchId, incomingEdge) => {
    if(!nodeId) return
    const branch = ensureBranchId(branchId, nodeId)
    const key = `${nodeId}|${branch}`
    if(processedNodeBranch.has(key)) return
    processedNodeBranch.add(key)
    setNodeBranch(nodeId, branch)

    const edgesOut = incomingEdges.get(nodeId) || []
    if(!edgesOut.length) return

    const node = nodeById.get(nodeId)
    const type = String(node?.type || '').toUpperCase()

    if(PASS_THROUGH_TYPES.has(type) || !isSeparator(nodeId)){
      const sorted = [...edgesOut].sort((a, b) => ensureBranchId(a.id).localeCompare(ensureBranchId(b.id)))
      for(const edge of sorted){
        assignEdge(edge, branch, 'pass_through')
      }
      return
    }

    const { edge: principal, reason, entries } = selectPrimary(nodeId, edgesOut, incomingEdge)
    if(!principal){
      return
    }
    assignEdge(principal, branch, reason || 'selected_main')
    for(const entry of entries){
      if(entry.edge === principal) continue
      const childBranch = createChildBranch(branch)
      assignEdge(entry.edge, childBranch, 'split_new_branch', branch)
    }
  }

  const generalNodes = nodes.filter((node) => String(node?.type || '').toUpperCase() === 'GENERAL')
  generalNodes.sort((a, b) => ensureBranchId(a.id).localeCompare(ensureBranchId(b.id)))

  for(const general of generalNodes){
    const baseBranch = ensureBranchId(general.branch_id, `GENERAL-${general.id}`)
    setNodeBranch(general.id, baseBranch)
    const outgoing = incomingEdges.get(general.id) || []
    if(!outgoing.length) continue
    const { edge: trunk, reason, entries } = selectPrimary(general.id, outgoing, null)
    if(trunk){
      assignEdge(trunk, baseBranch, 'trunk')
      for(const entry of entries){
        if(entry.edge === trunk) continue
        const child = createChildBranch(baseBranch)
        assignEdge(entry.edge, child, 'split_new_branch', baseBranch)
      }
    }
  }

  edges.forEach((edge) => {
    const branch = edgeBranch.get(edge.id) || ensureBranchId(edge.branch_id, edge.id)
    const downstream = edgeToId(edge)
    if(downstream) setNodeBranch(downstream, branch)
    assignEdge(edge, branch, 'fallback')
  })

  nodes.forEach((node) => {
    const explicit = ensureBranchId(nodeBranch.get(node.id))
    const existing = ensureBranchId(node.branch_id)
    const fallback = ensureBranchId(node.id)
    node.branch_id = explicit || existing || fallback
  })
}

export default assignBranchIds
