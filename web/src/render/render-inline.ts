import type { Selection, BaseType } from 'd3-selection'

type GroupSelection = Selection<SVGGElement, unknown, BaseType, unknown>

export function renderInline(g: GroupSelection): void {
  g.selectAll('path.inline').remove()
}
