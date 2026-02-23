/**
 * DOT layout adapter — drives viz.js (WASM GraphViz) to produce
 * node coordinates + edge B-spline waypoints for DrawIO rendering.
 *
 * Shared by all graph-theory diagram types (class, component, state, …).
 */

import { instance } from '@viz-js/viz';
import { parseEdgePos } from './edge-routing.ts';
import type { LayoutResult, LayoutNode, LayoutEdge, LayoutGroup } from '../model/index.ts';
import type { SemanticModel, SemanticEdge, SemanticGroup } from '../model/index.ts';
import { createNodeRenderer, createGlobalRenderers, computeTitleH, createRenderer } from '../primitives/index.ts';
import type { NodeDescriptor } from '../primitives/registry.ts';
import { resolveGroupShape } from '../primitives/group.ts';
import { unescapePlantUml } from '../shared/puml-unescape.ts';
import { Renderer } from '../primitives/renderer.ts';
import type { DotContext } from '../primitives/renderer.ts';
import { DOT_NODESEP_PX, DOT_RANKSEP_PX, DOT_MAX_ROW_WIDTH, DOT_FONT_SIZE } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Node size estimation
// ---------------------------------------------------------------------------

export function estimateNodeSize(node: SemanticNode) {
  return createNodeRenderer(node).measure();
}

// ---------------------------------------------------------------------------
// DOT generation
// ---------------------------------------------------------------------------

/**
 * Build DOT string from semantic model.
 *
 * Parameters mirror PlantUML's DotStringFactory / AbstractEntityDiagram:
 *   - nodesep = 0.35 in (25.2 px) — min 35 px → 0.486 in
 *   - ranksep = 0.8 in (57.6 px) — min 60 px → 0.833 in
 *   - remincross=true; searchsize=500  — graph-level optimisations
 *   - edge/node font defaults same as PlantUML (fontsize=11)
 *   - arrowtail/arrowhead=none — we draw arrows ourselves in DrawIO
 */
function buildDot(model: SemanticModel, renderers: Map<string, Renderer>, rootRenderers: Renderer[]): {
  dot: string;
  groupIds: Set<string>;
} {
  const PX_PER_INCH = 72;
  const rankdir = model.rankdir || 'TB';

  const nodesepInch = (DOT_NODESEP_PX / PX_PER_INCH).toFixed(6);   // 0.833333
  const ranksepInch = (DOT_RANKSEP_PX / PX_PER_INCH).toFixed(6);   // 1.111111

  // --- Compound edge analysis ---

  // Detect group-to-group edges: edges where from/to matches a group id.
  // Only include renderers that actually produce DOT clusters.
  const groupIds = new Set<string>();
  for (const g of model.groups || []) {
    const gr = renderers.get(g.id);
    if (gr && gr.isCluster) groupIds.add(g.id);
  }
  const groupsInEdges = new Set<string>();
  for (const edge of model.edges) {
    if (groupIds.has(edge.from)) groupsInEdges.add(edge.from);
    if (groupIds.has(edge.to)) groupsInEdges.add(edge.to);
  }
  const hasCompoundEdges = groupsInEdges.size > 0;

  // Collect which nodes have port-connected edges
  const portNodes = new Set<string>();
  for (const edge of model.edges) {
    if (edge.fromPort) portNodes.add(edge.from);
    if (edge.toPort) portNodes.add(edge.to);
  }

  // Build groupById for compound edge proxy analysis
  const groupById = new Map<string, SemanticGroup>();
  for (const g of model.groups || []) {
    groupById.set(g.id, g);
  }

  // For compound edges, find a representative descendant node for each group
  // so we can avoid proxy nodes (which cause extra whitespace in clusters).
  // Only groups that have no descendant nodes at all need a proxy.
  function findRepresentativeNode(groupId: string): string | undefined {
    const g = groupById.get(groupId);
    if (!g) return undefined;
    if (g.children.length > 0) return g.children[0];
    for (const cgId of g.childGroups) {
      const rep = findRepresentativeNode(cgId);
      if (rep) return rep;
    }
    return undefined;
  }

  // Check if groupA is an ancestor of groupB
  function isAncestorGroup(ancestorId: string, descendantId: string): boolean {
    let cur = groupById.get(descendantId);
    while (cur && cur.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = groupById.get(cur.parentId);
    }
    return false;
  }

  // Determine which groups need proxy nodes vs representative nodes for compound edges.
  // When one group is ancestor of the other, the ancestor's representative would be
  // inside the descendant's cluster, causing a self-loop. Use a proxy for the ancestor.
  const groupsNeedingProxy = new Set<string>();
  for (const edge of model.edges) {
    const isFromGroup = groupIds.has(edge.from);
    const isToGroup = groupIds.has(edge.to);
    if (isFromGroup && isToGroup) {
      if (isAncestorGroup(edge.from, edge.to)) groupsNeedingProxy.add(edge.from);
      else if (isAncestorGroup(edge.to, edge.from)) groupsNeedingProxy.add(edge.to);
    }
  }

  // groupId → DOT node name to use as edge endpoint
  const groupRepNode = new Map<string, string>();
  for (const gId of groupsInEdges) {
    if (groupsNeedingProxy.has(gId)) {
      groupRepNode.set(gId, `"__proxy_${gId}"`);
    } else {
      const rep = findRepresentativeNode(gId);
      if (rep) {
        groupRepNode.set(gId, `"${rep}"`);
      } else {
        groupsNeedingProxy.add(gId);
        groupRepNode.set(gId, `"__proxy_${gId}"`);
      }
    }
  }

  // --- Row packing utility ---

  // Collect which nodes participate in edges (for row-packing decisions)
  const connectedNodes = new Set<string>();
  for (const e of model.edges) {
    connectedNodes.add(e.from);
    connectedNodes.add(e.to);
  }

  /**
   * Pack a list of orphan node IDs into rows (greedy bin-packing).
   * Returns DOT rank constraints + invisible edges to enforce multi-row layout.
   *
   * @param maxRowWidth  Target row width in px.
   * @param maxPerRow    Max nodes per row (0 = no limit). Used inside groups
   *                     where width-based packing is unreliable due to
   *                     nested subgraph clusters sharing the same space.
   */
  function buildRowPacking(nodeIds: string[], indent: string, maxRowWidth = DOT_MAX_ROW_WIDTH, maxPerRow = 0): string[] {
    // Only pack nodes that are not connected by any edge
    const orphans = nodeIds.filter((id) => !connectedNodes.has(id));
    if (orphans.length <= 1) return [];
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentWidth = 0;

    for (const id of orphans) {
      const r = renderers.get(id);
      const w = r ? r.measure().width : 160;
      const needed = currentRow.length > 0 ? w + DOT_NODESEP_PX : w;

      const widthExceeded = currentRow.length > 0 && currentWidth + needed > maxRowWidth;
      const countExceeded = maxPerRow > 0 && currentRow.length >= maxPerRow;

      if (currentRow.length > 0 && (widthExceeded || countExceeded)) {
        rows.push(currentRow);
        currentRow = [id];
        currentWidth = w;
      } else {
        currentRow.push(id);
        currentWidth += needed;
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);
    if (rows.length <= 1) return [];

    const lines: string[] = [];
    for (const row of rows) {
      const ids = row.map((id) => `"${id}"`).join('; ');
      lines.push(`${indent}{rank=same; ${ids}}`);
    }
    for (let r = 0; r < rows.length - 1; r++) {
      const upper = rows[r][0];
      const lower = rows[r + 1][0];
      lines.push(`${indent}"${upper}" -> "${lower}" [style=invis]`);
    }
    return lines;
  }

  // --- Groups that have at least one edge to an external sibling node ---
  // Used by buildClusterDotBlock() to widen the cluster margin so the group
  // has enough space for external routing (e.g. snapped ports, or direct edges).
  const parentIdMap = new Map<string, string>();
  for (const g of model.groups || []) {
    for (const childId of g.children) parentIdMap.set(childId, g.id);
  }

  function isDescendantOrSelf(descId: string, ancId: string): boolean {
    let cur: string | undefined = descId;
    while (cur) {
      if (cur === ancId) return true;
      cur = parentIdMap.get(cur);
    }
    return false;
  }

  function getTopLevelAncestor(nodeId: string, targetParentId: string | undefined): string | undefined {
    let cur: string | undefined = nodeId;
    let prev: string | undefined = cur;
    while (cur) {
      if (parentIdMap.get(cur) === targetParentId) return cur;
      prev = cur;
      cur = parentIdMap.get(cur);
    }
    if (targetParentId === undefined) return prev;
    return undefined;
  }

  const groupsWithExternalEdge = new Set<string>();
  for (const g of model.groups || []) {
    for (const edge of model.edges) {
      // We only care about edges that connect DIRECTLY to the group itself,
      // or to a port node on the group's boundary.
      // Edges connecting to normal internal children do NOT trigger margin expansion.
      const fromIsGroup = edge.from === g.id;
      const toIsGroup = edge.to === g.id;
      const fromIsPort = parentIdMap.get(edge.from) === g.id && renderers.get(edge.from)?.isPort;
      const toIsPort = parentIdMap.get(edge.to) === g.id && renderers.get(edge.to)?.isPort;

      const fromInG = fromIsGroup || fromIsPort;
      const toInG = toIsGroup || toIsPort;
      
      if (fromInG && !toInG) {
        if (getTopLevelAncestor(edge.to, g.parentId) !== undefined) {
          groupsWithExternalEdge.add(g.id);
          break;
        }
      } else if (!fromInG && toInG) {
        if (getTopLevelAncestor(edge.from, g.parentId) !== undefined) {
          groupsWithExternalEdge.add(g.id);
          break;
        }
      }
    }
  }

  // --- Build DotContext for unified tree traversal ---
  const ctx: DotContext = {
    hasPortEdges: (id) => portNodes.has(id),
    needsProxy: (id) => groupsNeedingProxy.has(id),
    isConnected: (id) => connectedNodes.has(id),
    getRenderer: (id) => renderers.get(id),
    buildRowPacking,
    hasExternalEdge: (groupId) => groupsWithExternalEdge.has(groupId),
  };

  // --- Node + group DOT blocks (unified tree traversal) ---
  const nodeGroupLines: string[] = [];
  for (const r of rootRenderers) {
    nodeGroupLines.push(...r.buildDotBlock(ctx, '  '));
  }

  // Build set of edge ids that have link notes
  const linkNoteEdgeIds = new Set<string>();
  for (const note of model.notes || []) {
    if (note.onLink && note.linkEdgeId) linkNoteEdgeIds.add(note.linkEdgeId);
  }

  const edgeLines: string[] = [];
  for (const edge of model.edges) {
    // Use arrowtail=none,arrowhead=none — visual arrowheads are rendered by
    // DrawIO styles, not by Graphviz.  This avoids Graphviz reserving extra
    // space for arrow tips and keeps layout tight (matches PlantUML behaviour).
    const dir = edge.direction || null;
    const isInverted = dir === 'left' || dir === 'up';
    const isHorizontal = dir === 'left' || dir === 'right';
    const isFromGroup = groupIds.has(edge.from);
    const isToGroup = groupIds.has(edge.to);
    const fromSpec = isFromGroup ? (groupRepNode.get(edge.from) || `"${edge.from}"`)
      : edge.fromPort ? `"${edge.from}":"${edge.fromPort}"` : `"${edge.from}"`;
    const toSpec = isToGroup ? (groupRepNode.get(edge.to) || `"${edge.to}"`)
      : edge.toPort ? `"${edge.to}":"${edge.toPort}"` : `"${edge.to}"`;
    let attrs = 'arrowtail=none,arrowhead=none';
    // No ltail/lhead — we self-clip edges to group boundaries in extractLayout
    // Pass edge label to DOT so the layout engine reserves space for it,
    // preventing labels from overlapping adjacent clusters/nodes.
    // Unescape PlantUML sequences (\n → real newline) so DOT measures multi-line correctly.
    if (edge.label) {
      const dotLabel = unescapePlantUml(edge.label).replace(/"/g, '\\"');
      attrs += `,label="${dotLabel}"`;
    }
    // Emit minlen for all edges (PlantUML: minlen = length - 1).
    // Horizontal edges with explicit direction skip minlen since rank constraint handles placement.
    if (!isHorizontal) {
      const edgeLength = edge.length || 2; // default 2 if unset (normal vertical spacing)
      attrs += `,minlen=${edgeLength - 1}`;
    }
    // Swap DOT from/to for left/up direction hints (PlantUML inverts the edge)
    const dotFrom = isInverted ? toSpec : fromSpec;
    const dotTo = isInverted ? fromSpec : toSpec;
    edgeLines.push(`  ${dotFrom} -> ${dotTo} [${attrs}]`);
    // Emit rank=same for horizontal direction hints (left/right)
    if (isHorizontal) {
      const fromNodeId = isFromGroup ? (groupRepNode.get(edge.from) || `"${edge.from}"`) : `"${edge.from}"`;
      const toNodeId = isToGroup ? (groupRepNode.get(edge.to) || `"${edge.to}"`) : `"${edge.to}"`;
      edgeLines.push(`  {rank=same; ${fromNodeId}; ${toNodeId}}`);
    }
  }

  // Note nodes + positional DOT constraints
  // Group same-target/same-side notes for chaining (avoids overlap)
  const notesByTargetPos = new Map<string, { id: string; position: string }[]>();
  for (const note of model.notes || []) {
    if (!note.target || !note.position) continue;
    const key = `${note.target}::${note.position.toLowerCase()}`;
    if (!notesByTargetPos.has(key)) notesByTargetPos.set(key, []);
    notesByTargetPos.get(key)!.push({ id: note.id, position: note.position.toLowerCase() });
  }

  const noteLines: string[] = [];
  for (const note of model.notes || []) {
    if (note.onLink) {
      // Link notes: participate in DOT layout as intermediate nodes
      const r = renderers.get(note.id);
      if (!r) continue;
      noteLines.push(`  "${note.id}" [${r.buildDotAttributes(false)}]`);
      // Invisible edges position the note between the linked edge's endpoints.
      // High weight ensures DOT places the note close to the edge path.
      if (note.linkEdgeId) {
        const linkedEdge = model.edges.find(e => e.id === note.linkEdgeId);
        if (linkedEdge) {
          noteLines.push(`  "${linkedEdge.from}" -> "${note.id}" [style=invis,weight=10]`);
          noteLines.push(`  "${note.id}" -> "${linkedEdge.to}" [style=invis,weight=10]`);
        }
      }
      continue;
    }
    const r = renderers.get(note.id);
    if (!r) continue;
    noteLines.push(`  "${note.id}" [${r.buildDotAttributes(false)}]`);
    if (note.target) {
      const pos = (note.position || '').toLowerCase();
      const key = `${note.target}::${pos}`;
      const group = notesByTargetPos.get(key);
      const groupIdx = group ? group.findIndex(g => g.id === note.id) : -1;
      const isFirst = groupIdx === 0;

      if (pos === 'left' || pos === 'right') {
        if (isFirst) {
          // First note on this side: rank=same with target
          noteLines.push(`  { rank=same; "${note.id}"; "${note.target}" }`);
          if (pos === 'left') {
            noteLines.push(`  "${note.id}" -> "${note.target}" [style=invis]`);
          } else {
            noteLines.push(`  "${note.target}" -> "${note.id}" [style=invis]`);
          }
        } else {
          // Additional notes on same side: chain below previous note
          const prev = group![groupIdx - 1];
          noteLines.push(`  "${prev.id}" -> "${note.id}" [style=invis]`);
        }
      } else if (pos === 'top') {
        noteLines.push(`  "${note.id}" -> "${note.target}" [style=invis]`);
      } else if (pos === 'bottom') {
        noteLines.push(`  "${note.target}" -> "${note.id}" [style=invis]`);
      } else {
        // No position directive: default invisible edge
        noteLines.push(`  "${note.id}" -> "${note.target}" [style=invis]`);
      }
    }
  }

  // Legend node (placed at the bottom of the graph)
  if (model.legend) {
    const legendR = renderers.get('__legend__');
    if (legendR) {
      noteLines.push(`  "__legend__" [${legendR.buildDotAttributes(false)}]`);
      // Use rank=sink to push legend to the bottom
      noteLines.push(`  { rank=sink; "__legend__"; }`);
    }
  }

  // Row-packing for top-level orphan nodes (not in any group).
  const topNodeIds = rootRenderers.filter(r => !r.isCluster).map(r => r.id);
  const rankLines = buildRowPacking(topNodeIds, '  ');

  const dotStr = `digraph G {
  rankdir=${rankdir}
  nodesep=${nodesepInch}
  ranksep=${ranksepInch}
  remincross=true
  searchsize=500
  edge [fontsize=${DOT_FONT_SIZE},labelfontsize=${DOT_FONT_SIZE}]
  node [fontsize=${DOT_FONT_SIZE},height=0.35,width=0.55]
${nodeGroupLines.join('\n')}
${edgeLines.join('\n')}
${noteLines.join('\n')}
${rankLines.join('\n')}
}`;
  if ((globalThis as any).__DOT_DEBUG__) console.log(dotStr);
  return { dot: dotStr, groupIds };
}

// ---------------------------------------------------------------------------
// Coordinate extraction from viz.js JSON output
// ---------------------------------------------------------------------------

function extractLayout(
  vizJson: any,
  renderers: Map<string, Renderer>,
  edges: SemanticEdge[],
  groupIds: Set<string>,
): LayoutResult {
  const PX_PER_INCH = 72;
  const nodes: Record<string, LayoutNode> = {}
  const rawGroups: Array<{ id: string; x1: number; y1: number; x2: number; y2: number }> = [];

  // Parse node positions — pos is "x,y" in points (72 pt = 1 inch), center of node
  for (const obj of vizJson.objects || []) {
    const name: string = obj.name;

    // Cluster subgraph: has bb but no pos
    if (!obj.pos && obj.bb && typeof name === 'string' && name.startsWith('cluster_')) {
      const clusterId = name.slice('cluster_'.length);
      // Skip outer protection subgraphs (suffixed with _p0)
      if (clusterId.endsWith('_p0')) continue;
      const [x1, y1, x2, y2] = (obj.bb as string).split(',').map(Number);
      rawGroups.push({ id: clusterId, x1, y1, x2, y2 });
      continue;
    }

    if (!obj.pos) continue; // skip rank-same helper nodes
    // Skip invisible proxy/placeholder nodes used for compound edges or empty groups
    if (typeof name === 'string' && (name.startsWith('__proxy_') || name.startsWith('__empty_'))) continue;
    const [cx, cy] = (obj.pos as string).split(',').map(Number);
    // Prefer renderer's measure() (viz.js may report wrong size for HTML-label nodes)
    const r = renderers.get(name);
    const knownSize = r ? r.measure() : undefined;
    const wPt = knownSize ? knownSize.width : parseFloat(obj.width) * PX_PER_INCH;
    const hPt = knownSize ? knownSize.height : parseFloat(obj.height) * PX_PER_INCH;

    // Apply graphic center offset: shift the box so the visual graphic center
    // aligns with DOT's node center (cx,cy).  For nodes with icon + label-below
    // (e.g. actor, boundary, entity, control, circle), the visual center is
    // above the geometric center; the offset corrects this mismatch so edge
    // routing hits the icon rather than the label area.
    const offset = r ? r.graphicCenterOffset() : { dx: 0, dy: 0 };

    nodes[name] = {
      id: name,
      cx, cy,
      width: Math.round(wPt),
      height: Math.round(hPt),
      x: Math.round(cx - wPt / 2 + offset.dx),
      y: Math.round(cy - hPt / 2 + offset.dy),
    } as any;
    // Store raw xlabel position (Graphviz coords) for conversion after Y-flip
    if (obj.xlp && typeof obj.xlp === 'string') {
      const [xlx, xly] = (obj.xlp as string).split(',').map(Number);
      (nodes[name] as any).__rawXlp = { xlx, xly };
    }
  }

  // Graphviz Y axis is bottom-up, DrawIO is top-down → flip Y
  const allNodes = Object.values(nodes);
  const allMaxY = Math.max(
    allNodes.length ? Math.max(...allNodes.map((l) => l.y + l.height)) : 0,
    rawGroups.length ? Math.max(...rawGroups.map((g) => g.y2)) : 0,
  );

  for (const l of allNodes) {
    l.y = allMaxY - l.y - l.height;
    // Convert xlabel center from Graphviz bottom-up Y to DrawIO top-down Y
    const rawXlp = (l as any).__rawXlp;
    if (rawXlp) {
      l.xlabelPos = { x: rawXlp.xlx, y: allMaxY - rawXlp.xly };
      delete (l as any).__rawXlp;
    }
  }

  // Shift X so minimum is at 0
  const allMinX = Math.min(
    allNodes.length ? Math.min(...allNodes.map((l) => l.x)) : Infinity,
    rawGroups.length ? Math.min(...rawGroups.map((g) => g.x1)) : Infinity,
  );
  let xShift = 0;
  if (allMinX < 0) {
    xShift = -allMinX;
    for (const l of allNodes) {
      l.x += xShift;
      if (l.xlabelPos) l.xlabelPos.x += xShift;
    }
  }

  // Transform cluster bounding boxes to DrawIO coordinate system
  const layoutGroups: Record<string, LayoutGroup> = {};
  for (const rg of rawGroups) {
    // bb is "x1,y1,x2,y2" where y1<y2 in Graphviz (bottom-up)
    // After Y-flip: top = allMaxY - y2, bottom = allMaxY - y1
    const top = allMaxY - rg.y2;
    const bottom = allMaxY - rg.y1;
    const left = rg.x1 + xShift;
    const right = rg.x2 + xShift;
    layoutGroups[rg.id] = {
      id: rg.id,
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(right - left),
      height: Math.round(bottom - top),
    };
  }

  // Extract edge waypoints from viz.js B-spline data
  const layoutEdges: LayoutEdge[] = [];
  if (vizJson.edges) {
    for (let i = 0; i < vizJson.edges.length; i++) {
      const vizEdge = vizJson.edges[i];
      let fromName: string = vizJson.objects[vizEdge.tail].name;
      let toName: string = vizJson.objects[vizEdge.head].name;
      // Map proxy node names back to group ids for compound edges
      if (fromName.startsWith('__proxy_')) fromName = fromName.slice('__proxy_'.length);
      if (toName.startsWith('__proxy_')) toName = toName.slice('__proxy_'.length);
      // For compound edges using representative nodes, use the semantic model's
      // from/to (group ids) instead of the viz.js node names
      const semanticEdge = edges[i];
      if (semanticEdge) {
        fromName = semanticEdge.from;
        toName = semanticEdge.to;
      }
      const rawPos: string = vizEdge.pos || '';

      if ((globalThis as any).__EDGE_DEBUG__) {
        console.log(`[edge] ${fromName} -> ${toName} pos=${rawPos}`);
      }

      // For group self-connections, keep only start/end points — Graphviz
      // routes intermediate waypoints through the group interior which looks
      // wrong; let DrawIO draw its own self-loop around the group boundary.
      const isGroupSelfEdge = fromName === toName && layoutGroups[fromName];
      const edgeDir = semanticEdge?.direction;
      const isInverted = edgeDir === 'left' || edgeDir === 'up';
      let waypoints = parseEdgePos(rawPos, allMaxY, xShift, 0);
      if (isGroupSelfEdge && waypoints.length > 2) {
        waypoints = [waypoints[0], waypoints[waypoints.length - 1]];
      }

      // Reverse waypoints for direction-inverted edges (left/up swap DOT from/to)
      if (isInverted && waypoints.length > 1) {
        waypoints.reverse();
      }

      layoutEdges.push({
        id: edges[i]?.id || `e${i + 1}`,
        from: fromName,
        to: toName,
        points: waypoints,
        fromGroup: groupIds.has(fromName) ? fromName : undefined,
        toGroup: groupIds.has(toName) ? toName : undefined,
      });
    }
  }

  // Clip group edges to group boundaries.
  // Without compound=true, DOT routes edges to the representative child node
  // inside the cluster. We clip the path at the group boundary so the edge
  // visually connects to the group rectangle instead.
  for (const edge of layoutEdges) {
    if (!edge.points || edge.points.length < 2) continue;

    // fromGroup: the path starts at the representative node inside the group.
    // We need to clip from the start — find where the path exits the group
    // and replace the internal portion with the boundary crossing point.
    if (edge.fromGroup) {
      const g = layoutGroups[edge.fromGroup];
      if (g) {
        edge.points = clipPathAtGroupBoundary(edge.points, g, 'start');
      }
    }

    // toGroup: the path ends at the representative node inside the group.
    // We need to clip from the end — find where the path enters the group
    // and replace the internal portion with the boundary crossing point.
    if (edge.toGroup) {
      const g = layoutGroups[edge.toGroup];
      if (g) {
        edge.points = clipPathAtGroupBoundary(edge.points, g, 'end');
      }
    }
  }

  return { nodes, edges: layoutEdges, groups: Object.keys(layoutGroups).length > 0 ? layoutGroups : undefined };
}

/** Check if a point is inside (or on the boundary of) a group's bounding box */
function isInsideGroup(px: number, py: number, g: LayoutGroup): boolean {
  return px >= g.x && px <= g.x + g.width && py >= g.y && py <= g.y + g.height;
}

/**
 * Clip a path at the group boundary.
 *
 * - mode 'start': the path starts inside the group (from a representative node).
 *   Find the first segment that crosses the boundary, replace everything before
 *   the crossing with the crossing point.
 *
 * - mode 'end': the path ends inside the group (at a representative node).
 *   Find the last segment that crosses the boundary, replace everything after
 *   the crossing with the crossing point.
 */
function clipPathAtGroupBoundary(
  points: Array<{ x: number; y: number }>,
  g: LayoutGroup,
  mode: 'start' | 'end',
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points;

  if (mode === 'start') {
    // Walk from start, find the first segment where the path exits the group
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const p1Inside = isInsideGroup(p1.x, p1.y, g);
      const p2Inside = isInsideGroup(p2.x, p2.y, g);

      if (p1Inside && !p2Inside) {
        // Segment crosses from inside to outside — clip here
        const cross = segmentRectIntersection(p1, p2, g);
        if (cross) {
          return [{ x: Math.round(cross.x), y: Math.round(cross.y) }, ...points.slice(i + 1)];
        }
      }
      if (!p1Inside) {
        // Already outside — no clipping needed (edge starts outside group)
        return points;
      }
    }
    // All points inside: snap start to nearest boundary
    const snapped = snapToGroupBoundary(points[0], g);
    return [snapped, ...points.slice(1)];
  } else {
    // mode === 'end': walk from end backwards
    for (let i = points.length - 1; i > 0; i--) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const p1Inside = isInsideGroup(p1.x, p1.y, g);
      const p2Inside = isInsideGroup(p2.x, p2.y, g);

      if (!p1Inside && p2Inside) {
        // Segment crosses from outside to inside — clip here
        const cross = segmentRectIntersection(p1, p2, g);
        if (cross) {
          return [...points.slice(0, i), { x: Math.round(cross.x), y: Math.round(cross.y) }];
        }
      }
      if (!p2Inside) {
        // Already outside — no clipping needed
        return points;
      }
    }
    // All points inside: snap end to nearest boundary
    const snapped = snapToGroupBoundary(points[points.length - 1], g);
    return [...points.slice(0, -1), snapped];
  }
}

/**
 * Find the intersection point of a line segment with a rectangle boundary.
 * Returns the crossing point closest to p1, or null if no intersection.
 */
function segmentRectIntersection(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  g: LayoutGroup,
): { x: number; y: number } | null {
  const left = g.x;
  const right = g.x + g.width;
  const top = g.y;
  const bottom = g.y + g.height;

  const candidates: Array<{ x: number; y: number; t: number }> = [];

  // Check intersection with each of the 4 edges of the rectangle
  // Left edge (x = left)
  const t1 = segIntersectVertical(p1, p2, left, top, bottom);
  if (t1 != null) candidates.push({ x: left, y: p1.y + t1 * (p2.y - p1.y), t: t1 });
  // Right edge (x = right)
  const t2 = segIntersectVertical(p1, p2, right, top, bottom);
  if (t2 != null) candidates.push({ x: right, y: p1.y + t2 * (p2.y - p1.y), t: t2 });
  // Top edge (y = top)
  const t3 = segIntersectHorizontal(p1, p2, top, left, right);
  if (t3 != null) candidates.push({ x: p1.x + t3 * (p2.x - p1.x), y: top, t: t3 });
  // Bottom edge (y = bottom)
  const t4 = segIntersectHorizontal(p1, p2, bottom, left, right);
  if (t4 != null) candidates.push({ x: p1.x + t4 * (p2.x - p1.x), y: bottom, t: t4 });

  if (candidates.length === 0) return null;
  // Return the crossing closest to p1 (smallest t)
  candidates.sort((a, b) => a.t - b.t);
  return { x: candidates[0].x, y: candidates[0].y };
}

/** Parametric t for segment p1→p2 intersection with vertical line x=xVal, within [yMin,yMax] */
function segIntersectVertical(
  p1: { x: number; y: number }, p2: { x: number; y: number },
  xVal: number, yMin: number, yMax: number,
): number | null {
  const dx = p2.x - p1.x;
  if (Math.abs(dx) < 0.01) return null;
  const t = (xVal - p1.x) / dx;
  if (t < 0 || t > 1) return null;
  const y = p1.y + t * (p2.y - p1.y);
  if (y < yMin - 0.5 || y > yMax + 0.5) return null;
  return t;
}

/** Parametric t for segment p1→p2 intersection with horizontal line y=yVal, within [xMin,xMax] */
function segIntersectHorizontal(
  p1: { x: number; y: number }, p2: { x: number; y: number },
  yVal: number, xMin: number, xMax: number,
): number | null {
  const dy = p2.y - p1.y;
  if (Math.abs(dy) < 0.01) return null;
  const t = (yVal - p1.y) / dy;
  if (t < 0 || t > 1) return null;
  const x = p1.x + t * (p2.x - p1.x);
  if (x < xMin - 0.5 || x > xMax + 0.5) return null;
  return t;
}

/** Snap a point to the nearest point on a group's bounding rectangle */
function snapToGroupBoundary(pt: { x: number; y: number }, g: LayoutGroup): { x: number; y: number } {
  const left = g.x;
  const right = g.x + g.width;
  const top = g.y;
  const bottom = g.y + g.height;

  const candidates: Array<{ x: number; y: number; dist: number }> = [
    { x: left, y: clamp(pt.y, top, bottom), dist: 0 },
    { x: right, y: clamp(pt.y, top, bottom), dist: 0 },
    { x: clamp(pt.x, left, right), y: top, dist: 0 },
    { x: clamp(pt.x, left, right), y: bottom, dist: 0 },
  ];
  for (const c of candidates) {
    c.dist = (c.x - pt.x) ** 2 + (c.y - pt.y) ** 2;
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return { x: Math.round(candidates[0].x), y: Math.round(candidates[0].y) };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ---------------------------------------------------------------------------
// Note field-level alignment
// ---------------------------------------------------------------------------

/**
 * Align notes that target specific class fields (memberTarget) so their
 * vertical center matches the corresponding field row within the class.
 *
 * DOT handles the overall positioning (left/right/top/bottom via rank
 * constraints and edge direction). This function only fine-tunes Y for
 * notes that point to a specific field rather than the whole class.
 */
const PORT_HALF = 6; // half of PORT_SIZE (12px)
const PORT_SIZE = PORT_HALF * 2;

/**
 * Snap port nodes to their parent group boundary after DOT layout,
 * then clip edge waypoints for edges that cross the port from outside the group.
 *
 * Port nodes are kept inside their cluster in DOT so internal edges (port→child)
 * route correctly. However DOT routes external edges (outside→port) through the
 * cluster interior to reach the port. After snapping the port to the boundary,
 * those waypoints look wrong — we clip them at the port's snapped bounding box,
 * exactly like we clip group-boundary edges.
 */
function snapPortNodes(
  layout: LayoutResult,
  model: SemanticModel,
  renderers: Map<string, Renderer>,
): void {
  // Build nodeId → parentGroupId map for "same-group" detection
  const nodeGroupMap = new Map<string, string>();
  for (const group of model.groups || []) {
    for (const childId of group.children) nodeGroupMap.set(childId, group.id);
    for (const cgId of group.childGroups) nodeGroupMap.set(cgId, group.id);
  }

  for (const group of model.groups || []) {
    const groupBox = (layout.groups || {})[group.id];
    if (!groupBox) continue;
    for (const childId of group.children) {
      const r = renderers.get(childId);
      if (!r?.isPort) continue;
      const portNode = layout.nodes[childId];
      if (!portNode) continue;

      // --- Pass 1: External edges ---
      // For each external edge connected to this port:
      //   1. Clip the edge path at the parent group boundary.
      //   2. Use the resulting boundary crossing point to reposition the port
      //      so its center sits exactly on the group boundary where the edge
      //      enters/exits.  This guarantees that drawio2svg's perimeter
      //      projection (center → nearest waypoint) lands precisely on the
      //      port's rendered border without any distortion.
      let intersectionSet = false;
      for (const edge of layout.edges || []) {
        if (!edge.points || edge.points.length < 2) continue;

        if (edge.to === childId) {
          const otherGroupId = nodeGroupMap.get(edge.from);
          if (otherGroupId !== group.id) {
            // External → port: find precise boundary crossing via segmentRectIntersection
            const pts = edge.points;
            const lastPt = pts[pts.length - 1];
            const prevPt = pts[pts.length - 2];
            const cross = segmentRectIntersection(prevPt, lastPt, groupBox) || lastPt;
            // Reposition port center to crossing point (first external edge wins;
            // subsequent external edges to the same port should agree closely)
            if (!intersectionSet) {
              portNode.x = Math.round(cross.x) - PORT_HALF;
              portNode.y = Math.round(cross.y) - PORT_HALF;
              portNode.width = PORT_SIZE;
              portNode.height = PORT_SIZE;
              intersectionSet = true;
            }
            // Clip edge to the boundary crossing point
            edge.points = clipPathAtGroupBoundary(pts, groupBox, 'end');
          }
        } else if (edge.from === childId) {
          const otherGroupId = nodeGroupMap.get(edge.to);
          if (otherGroupId !== group.id) {
            // Port → external: find precise boundary crossing
            const pts = edge.points;
            const firstPt = pts[0];
            const nextPt = pts[1];
            const cross = segmentRectIntersection(nextPt, firstPt, groupBox) || firstPt;
            if (!intersectionSet) {
              portNode.x = Math.round(cross.x) - PORT_HALF;
              portNode.y = Math.round(cross.y) - PORT_HALF;
              portNode.width = PORT_SIZE;
              portNode.height = PORT_SIZE;
              intersectionSet = true;
            }
            edge.points = clipPathAtGroupBoundary(pts, groupBox, 'start');
          }
        }
      }

      // Fallback: if no external edge found, snap to group boundary by portKind
      if (!intersectionSet) {
        if (r.portKind === 'portout') {
          portNode.y = groupBox.y + groupBox.height - PORT_HALF;
        } else {
          portNode.y = groupBox.y - PORT_HALF;
        }
      }

      // --- Pass 2: Internal edges ---
      // Now that the port position is finalised, clip internal edges at the
      // port's own bounding box so they start/end at the port square.
      const portBox: LayoutGroup = {
        id: childId,
        x: portNode.x,
        y: portNode.y,
        width: PORT_SIZE,
        height: PORT_SIZE,
      };
      for (const edge of layout.edges || []) {
        if (!edge.points || edge.points.length < 2) continue;

        if (edge.to === childId) {
          const otherGroupId = nodeGroupMap.get(edge.from);
          if (otherGroupId === group.id) {
            // Internal → port: clip at port box
            edge.points = clipPathAtGroupBoundary(edge.points, portBox, 'end');
          }
        } else if (edge.from === childId) {
          const otherGroupId = nodeGroupMap.get(edge.to);
          if (otherGroupId === group.id) {
            // Port → internal: clip at port box
            edge.points = clipPathAtGroupBoundary(edge.points, portBox, 'start');
          }
        }
      }
    }
  }
}

function alignFieldNotes(
  nodes: Record<string, LayoutNode>,
  notes: Array<{ id: string; position?: string; target?: string; memberTarget?: string }>,
  modelNodes: SemanticNode[],
): void {
  for (const note of notes) {
    if (!note.memberTarget || !note.target) continue;
    const noteLayout = nodes[note.id];
    const targetLayout = nodes[note.target];
    if (!noteLayout || !targetLayout) continue;

    const sep = note.memberTarget.indexOf('::');
    if (sep < 0) continue;
    const classId = note.memberTarget.slice(0, sep);
    const memberName = note.memberTarget.slice(sep + 2);

    const targetNode = modelNodes.find(n => n.id === classId);
    if (!targetNode?.bodyLines) continue;

    // Find the field index in bodyLines
    let fieldIndex = -1;
    for (let i = 0; i < targetNode.bodyLines.length; i++) {
      const bl = targetNode.bodyLines[i];
      const text = typeof bl === 'string' ? bl : bl.text;
      const stripped = text.replace(/^[+\-#~*]\s*/, '').trim();
      if (stripped === memberName || stripped.includes(memberName)) {
        fieldIndex = i;
        break;
      }
    }
    if (fieldIndex < 0) continue;

    // Calculate field center Y within the class box using proportional distribution.
    // This avoids needing to know exact per-row heights or separator positions.
    const titleH = computeTitleH(targetNode);
    const bodyH = targetLayout.height - titleH;
    const numRows = targetNode.bodyLines.length;
    if (numRows === 0) continue;
    const rowSpacing = bodyH / numRows;
    const fieldCenterY = titleH + rowSpacing * (fieldIndex + 0.5);

    // Adjust note Y to align center with field center
    noteLayout.y = targetLayout.y + fieldCenterY - noteLayout.height / 2;
  }

  // Resolve overlaps: same-side notes targeting same class
  const groups = new Map<string, typeof notes>();
  for (const note of notes) {
    if (!note.memberTarget || !note.position || !note.target) continue;
    const key = `${note.target}::${note.position.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(note);
  }
  for (const group of Array.from(groups.values())) {
    if (group.length <= 1) continue;
    // Sort by current Y position
    group.sort((a, b) => (nodes[a.id]?.y ?? 0) - (nodes[b.id]?.y ?? 0));
    const GAP = 10;
    for (let i = 1; i < group.length; i++) {
      const prev = nodes[group[i - 1].id];
      const cur = nodes[group[i].id];
      if (!prev || !cur) continue;
      const minY = prev.y + prev.height + GAP;
      if (cur.y < minY) cur.y = minY;
    }
  }


}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let vizInstance: any = null;
let vizBackup: any = null;

async function getViz() {
  if (!vizInstance) {
    vizInstance = await instance();
  }
  return vizInstance;
}

/**
 * Swap in the backup viz.js instance after the primary becomes corrupt.
 * Returns true if a backup was available.
 */
function swapToBackup(): boolean {
  if (vizBackup) {
    vizInstance = vizBackup;
    vizBackup = null;
    // Recreate another backup in the background for future recovery
    instance().then(v => { vizBackup = v; });
    return true;
  }
  return false;
}

/**
 * Pre-warm the viz.js WASM instance.
 * Must be called (and awaited) once before using `dotLayoutSync()`.
 */
export async function initViz() {
  await getViz();
  // Pre-create a backup instance for crash recovery
  if (!vizBackup) {
    vizBackup = await instance();
  }
}

/** Layout output including stateful renderers for the generation phase. */
export interface DotLayoutResult {
  layout: LayoutResult;
  renderers: Map<string, Renderer>;
}

// ---------------------------------------------------------------------------
// Title positioning  (negative Y — not routed through DOT)
// ---------------------------------------------------------------------------

/**
 * Place the __title__ renderer above the diagram using negative Y.
 * DrawIO supports negative coordinates, so no DOT node is needed.
 * The title renderer's measure() already includes a bottom gap.
 */
function positionTitle(layout: LayoutResult, renderers: Map<string, Renderer>): void {
  const titleR = renderers.get('__title__');
  if (!titleR) return;

  const sz = titleR.measure();
  const nodeValues = Object.values(layout.nodes);
  if (nodeValues.length === 0) return;

  // Compute diagram bounding box
  const minX = Math.min(...nodeValues.map(n => n.x));
  const maxX = Math.max(...nodeValues.map(n => n.x + n.width));
  const minY = Math.min(...nodeValues.map(n => n.y));

  const diagramWidth = maxX - minX;
  const titleX = minX + (diagramWidth - sz.width) / 2;
  const titleY = minY - sz.height; // height already includes bottom gap

  layout.nodes['__title__'] = {
    id: '__title__',
    x: Math.round(titleX),
    y: Math.round(titleY),
    width: sz.width,
    height: sz.height,
  };
}

/**
 * Build renderer tree: create GroupRenderers, wire child renderers,
 * and return ordered root renderer list for DOT generation.
 */
function buildRendererTree(
  model: SemanticModel,
  renderers: Map<string, Renderer>,
): Renderer[] {
  const groups = model.groups || [];
  if (groups.length === 0) {
    // No groups — all node renderers are roots (preserving document order)
    return model.nodes.map(n => renderers.get(n.id)).filter(Boolean) as Renderer[];
  }

  // Create or configure container renderers for each group.
  // State-type groups reuse the existing StateNodeRenderer (which adapts
  // its behaviour based on whether children are wired to it).
  // Non-state groups create a per-shape renderer via the node registry.
  const globalPkgStyle = model.skinparams?.packageStyle;
  const groupRenderers = new Map<string, Renderer>();
  for (const g of groups) {
    if (g.type === 'state') {
      // Reuse the StateNodeRenderer already created for this node
      const existing = renderers.get(g.id);
      if (existing) {
        groupRenderers.set(g.id, existing);
      }
    } else {
      const shape = resolveGroupShape(g.type, g.stereotype, globalPkgStyle, g.id);
      const gr = createNodeRenderer({ id: g.id, label: g.label, stereotype: shape, color: g.color, style: g.style });
      groupRenderers.set(g.id, gr);
      renderers.set(g.id, gr);
    }
  }

  // Wire child renderers to container renderers (unified — no children/childGroups split)
  const nodeGroupMap = new Map<string, string>();
  for (const g of groups) {
    const gr = groupRenderers.get(g.id);
    if (!gr) continue;
    for (const childId of g.children) {
      nodeGroupMap.set(childId, g.id);
      const r = renderers.get(childId);
      if (r) gr.addChild(r);
    }
    for (const cgId of g.childGroups) {
      const cgr = groupRenderers.get(cgId);
      if (cgr && cgr.isCluster) {
        // Non-empty container → add as nested cluster child
        gr.addChild(cgr);
      } else {
        // Empty state (leaf) → treat as regular child node
        const r = renderers.get(cgId);
        if (r) {
          gr.addChild(r);
          nodeGroupMap.set(cgId, g.id);
        }
      }
    }
  }

  // Build root renderer list: top-level nodes first, then top-level groups
  // (preserves current DOT output order for layout stability)
  const rootRenderers: Renderer[] = [];
  for (const node of model.nodes) {
    // Skip nodes managed by a container renderer
    if (groupRenderers.has(node.id)) continue;
    if (nodeGroupMap.has(node.id)) continue;
    const r = renderers.get(node.id);
    if (r) rootRenderers.push(r);
  }
  for (const g of groups) {
    if (!g.parentId) {
      const gr = groupRenderers.get(g.id);
      if (gr) rootRenderers.push(gr);
    }
  }
  return rootRenderers;
}

/**
 * Lay out a SemanticModel using viz.js DOT engine.
 * Returns layout coordinates and pre-built renderers for generation.
 */
export async function dotLayout(model: SemanticModel): Promise<DotLayoutResult> {
  // Derive visibility-icon flag from skinparams
  const visIcons = !(model.skinparams && model.skinparams.classAttributeIconSize === '0');
  const activityShape = model.skinparams?.activityShape;
  const actorStyle = model.skinparams?.actorStyle;

  // 1. Create renderers for each node (renderers self-measure in buildDotAttributes)
  const renderers = new Map<string, Renderer>();
  for (const node of model.nodes) {
    const desc: NodeDescriptor = { ...node };
    if (!visIcons) desc.visibilityIcons = false;
    if (activityShape) desc.activityShape = activityShape;
    if (actorStyle) desc.actorStyle = actorStyle;
    renderers.set(node.id, createNodeRenderer(desc));
  }
  for (const note of model.notes || []) {
    renderers.set(note.id, createRenderer('note', { id: note.id, lines: note.text.split('\n') }));
  }
  // Global renderers (title, legend) via factory
  createGlobalRenderers(model).forEach((r, id) => renderers.set(id, r));

  // 2. Build renderer tree (groups hold child renderers)
  const rootRenderers = buildRendererTree(model, renderers);

  // 3. Generate DOT string
  const { dot, groupIds } = buildDot(model, renderers, rootRenderers);

  // 4. Render via viz.js (JSON output = pos/width/height, no xdot draw ops)
  const viz = await getViz();
  let vizJson;
  try {
    vizJson = viz.renderJSON(dot);
  } catch (e) {
    // viz.js WASM instance may become corrupted after certain layouts;
    // swap to backup instance and retry.
    if (swapToBackup()) {
      vizJson = vizInstance.renderJSON(dot);
    } else {
      throw e;
    }
  }

  // 5. Extract + transform coordinates
  const layout = extractLayout(vizJson, renderers, model.edges, groupIds);

  // 5a. Snap port nodes to their parent group boundary
  snapPortNodes(layout, model, renderers);

  // 6. Fine-tune field-targeting notes (memberTarget) Y alignment
  alignFieldNotes(layout.nodes, model.notes || [], model.nodes);

  // 7. Position title above diagram with negative Y (not via DOT)
  positionTitle(layout, renderers);

  return { layout, renderers };
}

/**
 * Synchronous layout — requires viz instance to be pre-warmed.
 * Call `dotLayout()` at least once first, or use this after awaiting getViz().
 */
export function dotLayoutSync(model: SemanticModel): DotLayoutResult {
  if (!vizInstance) {
    throw new Error('viz.js instance not initialized. Call dotLayout() first or await getViz().');
  }

  // Derive visibility-icon flag from skinparams
  const visIcons = !(model.skinparams && model.skinparams.classAttributeIconSize === '0');
  const activityShape = model.skinparams?.activityShape;
  const actorStyle = model.skinparams?.actorStyle;

  const renderers = new Map<string, Renderer>();
  for (const node of model.nodes) {
    const desc: NodeDescriptor = { ...node };
    if (!visIcons) desc.visibilityIcons = false;
    if (activityShape) desc.activityShape = activityShape;
    if (actorStyle) desc.actorStyle = actorStyle;
    renderers.set(node.id, createNodeRenderer(desc));
  }
  for (const note of model.notes || []) {
    renderers.set(note.id, createRenderer('note', { id: note.id, lines: note.text.split('\n'), color: note.color }));
  }
  // Global renderers (title, legend) via factory
  createGlobalRenderers(model).forEach((r, id) => renderers.set(id, r));

  const rootRenderers = buildRendererTree(model, renderers);

  const { dot, groupIds } = buildDot(model, renderers, rootRenderers);
  let vizJson;
  try {
    vizJson = vizInstance.renderJSON(dot);
  } catch (e) {
    // viz.js WASM instance may become corrupted after certain layouts;
    // swap to backup instance and retry.
    if (swapToBackup()) {
      vizJson = vizInstance.renderJSON(dot);
    } else {
      throw e;
    }
  }
  const layout = extractLayout(vizJson, renderers, model.edges, groupIds);

  // Snap port nodes to their parent group boundary
  snapPortNodes(layout, model, renderers);

  alignFieldNotes(layout.nodes, model.notes || [], model.nodes);

  // Position title above diagram with negative Y (not via DOT)
  positionTitle(layout, renderers);

  return { layout, renderers };
}
