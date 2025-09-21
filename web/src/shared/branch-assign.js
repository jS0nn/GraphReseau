const INLINE_BRANCH_LOCK_TYPES = new Set(['VANNE'])

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

export function assignBranchIds(nodes = [], edges = []){
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const adjacency = new Map()
  const nodeBranch = new Map()
  const edgeOrder = new Map()

  const addAdjacency = (from, edge, neighbor) => {
    if(!from) return
    if(!adjacency.has(from)) adjacency.set(from, [])
    adjacency.get(from).push({ edge, neighbor })
  }

  edges.forEach((edge, index) => {
    const from = edge.from_id ?? edge.source
    const to = edge.to_id ?? edge.target
    addAdjacency(from, edge, to)
    addAdjacency(to, edge, from)
    edgeOrder.set(edge.id, index)
    edge.branch_id = ensureBranchId(edge.branch_id)
  })

  nodes.forEach((node) => {
    const bid = ensureBranchId(node?.branch_id)
    if(bid) nodeBranch.set(node.id, bid)
  })

  const visitedNodes = new Set()
  const visitedEdges = new Set()

  const processComponent = (startId) => {
    if(!startId || visitedNodes.has(startId)) return
    const queue = []
    const branch = ensureBranchId(nodeBranch.get(startId), adjacency.get(startId)?.[0]?.edge?.branch_id || adjacency.get(startId)?.[0]?.edge?.id || startId)
    nodeBranch.set(startId, branch)
    const root = nodeById.get(startId)
    if(root) root.branch_id = branch
    queue.push({ nodeId: startId, parentEdgeId: null })

    while(queue.length){
      const { nodeId, parentEdgeId } = queue.shift()
      if(!nodeId || visitedNodes.has(nodeId)) continue
      visitedNodes.add(nodeId)

      const branchAtNode = ensureBranchId(nodeBranch.get(nodeId), nodeId)
      nodeBranch.set(nodeId, branchAtNode)
      const node = nodeById.get(nodeId)
      if(node) node.branch_id = branchAtNode

      const connections = adjacency.get(nodeId) || []
      const childEntries = []
      for(const entry of connections){
        const { edge, neighbor } = entry
        if(!edge) continue
        if(edge.id === parentEdgeId){
          edge.branch_id = ensureBranchId(edge.branch_id, branchAtNode || edge.id)
          visitedEdges.add(edge.id)
          continue
        }
        if(visitedEdges.has(edge.id)) continue
        childEntries.push(entry)
      }

      if(!childEntries.length) continue

      const nodeType = String(node?.type || '').toUpperCase()
      if(INLINE_BRANCH_LOCK_TYPES.has(nodeType)){
        childEntries.forEach(({ edge, neighbor }) => {
          const branchValue = ensureBranchId(branchAtNode) || ensureBranchId(edge.branch_id) || edge.id
          edge.branch_id = branchValue
          visitedEdges.add(edge.id)
          if(neighbor){
            nodeBranch.set(neighbor, branchValue)
            const child = nodeById.get(neighbor)
            if(child) child.branch_id = branchValue
            queue.push({ nodeId: neighbor, parentEdgeId: edge.id })
          }
        })
        continue
      }

      childEntries.sort((a, b) => {
        const diff = diameterValue(b.edge) - diameterValue(a.edge)
        if(diff !== 0) return diff
        return (edgeOrder.get(a.edge.id) ?? 0) - (edgeOrder.get(b.edge.id) ?? 0)
      })

      childEntries.forEach(({ edge, neighbor }, idx) => {
        if(!edge) return
        const isMain = idx === 0
        let branchValue = isMain ? ensureBranchId(branchAtNode) : ensureBranchId(edge.branch_id)
        if(!branchValue || (!isMain && branchValue === branchAtNode)){
          branchValue = edge.id
        }
        edge.branch_id = branchValue
        visitedEdges.add(edge.id)
        if(neighbor){
          nodeBranch.set(neighbor, branchValue)
          const child = nodeById.get(neighbor)
          if(child) child.branch_id = branchValue
          queue.push({ nodeId: neighbor, parentEdgeId: edge.id })
        }
      })
    }
  }

  const generalRoots = nodes.filter((n) => String(n?.type || '').toUpperCase() === 'GENERAL')
  generalRoots.forEach((node) => processComponent(node.id))

  nodes.forEach((node) => {
    if(!visitedNodes.has(node.id)){
      processComponent(node.id)
    }
  })

  edges.forEach((edge) => {
    edge.branch_id = ensureBranchId(edge.branch_id) || edge.id
    const target = edge.to_id ?? edge.target
    if(target){
      const node = nodeById.get(target)
      if(node){
        node.branch_id = ensureBranchId(node.branch_id) || edge.branch_id
      }
    }
    const source = edge.from_id ?? edge.source
    if(source){
      const node = nodeById.get(source)
      if(node && !ensureBranchId(node.branch_id)) node.branch_id = edge.branch_id
    }
  })
}

export default assignBranchIds
