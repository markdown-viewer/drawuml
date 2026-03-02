/**
 * DOT layout adapter — drives viz.js (WASM GraphViz) to produce
 * node coordinates + edge B-spline waypoints for DrawIO rendering.
 *
 * Shared by all graph-theory diagram types (class, component, state, …).
 */

import { instance } from '@viz-js/viz';
import { parseEdgePos } from './edge-routing.ts';
import type { LayoutResult, LayoutNode, LayoutEdge, LayoutGroup } from '../model/index.ts';
import type { SemanticModel, SemanticEdge, SemanticGroup, SemanticNode } from '../model/index.ts';
import { createNodeRenderer } from '../primitives/index.ts';
import { Renderer } from '../primitives/renderer.ts';
import { createRenderers, buildRendererTree } from './renderer-tree.ts';
import { snapPortNodes, alignFieldNotes, positionTitle, clipPathAtGroupBoundary, rearrangeSwimlanes, fixNodeSpacing, fixOrthoEdges, avoidNodeCollisions } from './post-process.ts';
import { layoutGraphToDot } from './dot/dot-adapter.ts';
import type { Theme } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Node size estimation
// ---------------------------------------------------------------------------

export function estimateNodeSize(node: SemanticNode) {
  return createNodeRenderer(node).measure();
}

// NOTE: buildDot() has been removed — replaced by layoutGraphToDot() in dot/dot-adapter.ts


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
    const gs = r ? r.graphicSize() : null;
    const offsetDy = gs ? (gs.height - hPt) / 2 : 0;

    nodes[name] = {
      id: name,
      cx, cy,
      width: Math.round(wPt),
      height: Math.round(hPt),
      x: Math.round(cx - wPt / 2),
      y: Math.round(cy - hPt / 2 + offsetDy),
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

      // Parse cardinality label positions (taillabel/headlabel centers from Graphviz).
      // For inverted edges, DOT from/to are swapped so tail↔head maps to cardTo↔cardFrom.
      let cardFromPos: { x: number; y: number } | undefined;
      let cardToPos: { x: number; y: number } | undefined;
      if (vizEdge.tail_lp && typeof vizEdge.tail_lp === 'string') {
        const [tlx, tly] = (vizEdge.tail_lp as string).split(',').map(Number);
        const pos = { x: Math.round(tlx + xShift), y: Math.round(allMaxY - tly) };
        if (isInverted) cardToPos = pos; else cardFromPos = pos;
      }
      if (vizEdge.head_lp && typeof vizEdge.head_lp === 'string') {
        const [hlx, hly] = (vizEdge.head_lp as string).split(',').map(Number);
        const pos = { x: Math.round(hlx + xShift), y: Math.round(allMaxY - hly) };
        if (isInverted) cardFromPos = pos; else cardToPos = pos;
      }

      // Parse center label position (lp) from Graphviz.
      // This is the center point of the edge label text.
      let labelPos: { x: number; y: number } | undefined;
      if (vizEdge.lp && typeof vizEdge.lp === 'string') {
        const [lpx, lpy] = (vizEdge.lp as string).split(',').map(Number);
        labelPos = { x: Math.round(lpx + xShift), y: Math.round(allMaxY - lpy) };
      }

      layoutEdges.push({
        id: edges[i]?.id || `e${i + 1}`,
        from: fromName,
        to: toName,
        points: waypoints,
        fromGroup: groupIds.has(fromName) ? fromName : undefined,
        toGroup: groupIds.has(toName) ? toName : undefined,
        labelPos,
        cardFromPos,
        cardToPos,
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

/**
 * Lay out a SemanticModel using viz.js DOT engine.
 * Returns layout coordinates and pre-built renderers for generation.
 */
export async function dotLayout(model: SemanticModel, options?: { ortho?: boolean; theme?: Theme }): Promise<DotLayoutResult> {
  const useOrtho = options?.ortho ?? false;
  const theme = options?.theme;

  // 1. Create renderers for each node
  const renderers = createRenderers(model, { theme });

  // 2. Build renderer tree (groups hold child renderers)
  const rootRenderers = buildRendererTree(model, renderers, { theme });

  // 3. Generate DOT string from LayoutGraphNode IR
  const rootNodes = rootRenderers.map(r => r.buildLayoutGraph());
  const { dot: dotRaw, groupIds } = layoutGraphToDot(rootNodes, model, renderers, theme);

  // Inject splines=ortho for swimlane diagrams when requested
  // Skip ortho for LR mode — Graphviz hangs with splines=ortho + rankdir=LR + cross-cluster edges
  const skipOrthoSplines = model.rankdir === 'LR';
  const dot = (useOrtho && !skipOrthoSplines)
    ? dotRaw.replace('remincross=true', 'remincross=true\n  splines=ortho')
    : dotRaw;

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

  // 5a. Swimlane column rearrangement (if activity swimlanes present)
  rearrangeSwimlanes(layout, model, theme);

  // 5a2. Fix node spacing, ortho edges, and node collision avoidance for swimlane diagrams
  if (useOrtho) {
    fixNodeSpacing(layout, model, theme);
    fixOrthoEdges(layout, model);
    avoidNodeCollisions(layout, model, theme);
  }

  // 5b. Snap port nodes to their parent group boundary
  snapPortNodes(layout, model, renderers, theme);

  // 6. Fine-tune field-targeting notes (memberTarget) Y alignment
  alignFieldNotes(layout.nodes, model.notes || [], model.nodes, theme);

  // 7. Position title above diagram with negative Y (not via DOT)
  positionTitle(layout, renderers);

  return { layout, renderers };
}
