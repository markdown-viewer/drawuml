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
import { snapPortNodes, alignFieldNotes, positionTitle, clipPathAtGroupBoundary, rearrangeSwimlanes, fixNodeSpacing, fixOrthoEdges, avoidNodeCollisions, separateOverlappingEdges, simplifyBacktrackEdges } from './post-process.ts';
import { layoutGraphToDot } from './dot/dot-adapter.ts';
import { createTheme, type Theme } from '../shared/theme.ts';

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
  labelGap: number,
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
    // Skip invisible proxy/placeholder/spine nodes
    if (typeof name === 'string' && (name.startsWith('__proxy_') || name.startsWith('__empty_') || name.startsWith('__spine_'))) continue;
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
      width: wPt,
      height: hPt,
      x: cx - wPt / 2,
      y: cy - hPt / 2 + offsetDy,
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
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
  }

  // Extract edge waypoints from viz.js B-spline data
  const layoutEdges: LayoutEdge[] = [];
  if (vizJson.edges) {
    let semanticIdx = 0;
    for (let i = 0; i < vizJson.edges.length; i++) {
      const vizEdge = vizJson.edges[i];
      let fromName: string = vizJson.objects[vizEdge.tail].name;
      let toName: string = vizJson.objects[vizEdge.head].name;

      // Skip spine invisible edges — they are not semantic edges
      if (fromName.startsWith('__spine_') || toName.startsWith('__spine_')) continue;

      // Map proxy node names back to group ids for compound edges
      if (fromName.startsWith('__proxy_')) fromName = fromName.slice('__proxy_'.length);
      if (toName.startsWith('__proxy_')) toName = toName.slice('__proxy_'.length);
      // For compound edges using representative nodes, use the semantic model's
      // from/to (group ids) instead of the viz.js node names
      const semanticEdge = edges[semanticIdx];
      if (semanticEdge) {
        fromName = semanticEdge.from;
        toName = semanticEdge.to;
      }
      semanticIdx++;
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
        const pos = { x: tlx + xShift, y: allMaxY - tly };
        if (isInverted) cardToPos = pos; else cardFromPos = pos;
      }
      if (vizEdge.head_lp && typeof vizEdge.head_lp === 'string') {
        const [hlx, hly] = (vizEdge.head_lp as string).split(',').map(Number);
        const pos = { x: hlx + xShift, y: allMaxY - hly };
        if (isInverted) cardFromPos = pos; else cardToPos = pos;
      }

      // Parse center label position (lp) from Graphviz.
      // This is the center point of the edge label text.
      let labelPos: { x: number; y: number } | undefined;
      if (vizEdge.lp && typeof vizEdge.lp === 'string') {
        const [lpx, lpy] = (vizEdge.lp as string).split(',').map(Number);
        labelPos = { x: lpx + xShift, y: allMaxY - lpy };
      }

      // Offset label positions by gap away from edge line / endpoint
      if (labelPos && waypoints.length >= 2) {
        const edgeX = (waypoints[0].x + waypoints[waypoints.length - 1].x) / 2;
        const dx = labelPos.x - edgeX;
        if (Math.abs(dx) > 0.1) labelPos.x += Math.sign(dx) * labelGap;
      }
      if (cardFromPos && waypoints.length >= 1) {
        const ep = waypoints[0];
        const dx = cardFromPos.x - ep.x;
        const dy = cardFromPos.y - ep.y;
        if (Math.abs(dx) > 0.1) cardFromPos.x += Math.sign(dx) * labelGap;
        if (Math.abs(dy) > 0.1) cardFromPos.y += Math.sign(dy) * labelGap;
      }
      if (cardToPos && waypoints.length >= 1) {
        const ep = waypoints[waypoints.length - 1];
        const dx = cardToPos.x - ep.x;
        const dy = cardToPos.y - ep.y;
        if (Math.abs(dx) > 0.1) cardToPos.x += Math.sign(dx) * labelGap;
        if (Math.abs(dy) > 0.1) cardToPos.y += Math.sign(dy) * labelGap;
      }

      layoutEdges.push({
        id: semanticEdge?.id || `e${semanticIdx}`,
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

    // For ancestor↔descendant group edges, skip clipping the ancestor
    // group boundary — the edge should originate from inside the ancestor.
    let skipFromClip = false;
    let skipToClip = false;
    if (edge.fromGroup && edge.toGroup) {
      const fg = layoutGroups[edge.fromGroup];
      const tg = layoutGroups[edge.toGroup];
      if (fg && tg) {
        if (tg.x >= fg.x && tg.y >= fg.y
            && tg.x + tg.width <= fg.x + fg.width
            && tg.y + tg.height <= fg.y + fg.height) {
          // toGroup inside fromGroup — fromGroup is ancestor, skip its clip
          skipFromClip = true;
        } else if (fg.x >= tg.x && fg.y >= tg.y
            && fg.x + fg.width <= tg.x + tg.width
            && fg.y + fg.height <= tg.y + tg.height) {
          // fromGroup inside toGroup — toGroup is ancestor, skip its clip
          skipToClip = true;
        }
      }
    }

    // fromGroup: the path starts at the representative node inside the group.
    // We need to clip from the start — find where the path exits the group
    // and replace the internal portion with the boundary crossing point.
    if (edge.fromGroup && !skipFromClip) {
      const g = layoutGroups[edge.fromGroup];
      if (g) {
        edge.points = clipPathAtGroupBoundary(edge.points, g, 'start');
      }
    }

    // toGroup: the path ends at the representative node inside the group.
    // We need to clip from the end — find where the path enters the group
    // and replace the internal portion with the boundary crossing point.
    if (edge.toGroup && !skipToClip) {
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
    // Pre-create a backup instance for crash recovery
    if (!vizBackup) {
      instance().then(v => { vizBackup = v; });
    }
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
  const theme = options?.theme ?? createTheme();

  // 1. Create renderers for each node
  const renderers = createRenderers(model, { theme });

  // 2. Build renderer tree (groups hold child renderers)
  const rootRenderers = buildRendererTree(model, renderers, { theme });

  // 3. Generate DOT string from LayoutGraphNode IR
  const rootNodes = rootRenderers.map(r => r.buildLayoutGraph());

  // Inject splines=ortho for swimlane diagrams when requested
  // Skip ortho for LR mode — Graphviz hangs with splines=ortho + rankdir=LR + cross-cluster edges
  const skipOrthoSplines = model.rankdir === 'LR';
  const injectOrtho = (d: string) => (useOrtho && !skipOrthoSplines)
    ? d.replace('remincross=true', 'remincross=true\n  splines=ortho') : d;

  const renderViz = async (dotStr: string) => {
    const viz = await getViz();
    try {
      return viz.renderJSON(dotStr);
    } catch (e) {
      if (swapToBackup()) return vizInstance.renderJSON(dotStr);
      throw e;
    }
  };

  // --- Two-pass swimlane layout ---
  // Detect TB-mode swimlane diagrams that need column ordering
  const swimGroup = model.rankdir !== 'LR' ? (model.groups || []).find(
    g => g.type === 'swimlane_container' && g.concurrentRegions && g.concurrentRegions.length > 1
  ) : undefined;

  let swimlaneSpineOrder: Array<{ regionIdx: number; repNodeId: string }> | undefined;

  if (swimGroup) {
    // Pass 1: normal layout — determine natural column ordering
    const { dot: dot1Raw, groupIds: gids1 } = layoutGraphToDot(rootNodes, model, renderers, theme);
    const vizJson1 = await renderViz(injectOrtho(dot1Raw));
    const layout1 = extractLayout(vizJson1, renderers, model.edges, gids1, theme.padXS);

    // Build region order sorted by DOT's X placement
    const regions = swimGroup.concurrentRegions!;
    const orderData: Array<{ regionIdx: number; repNodeId: string; x: number }> = [];
    for (let i = 0; i < regions.length; i++) {
      if (regions[i].length === 0) continue;
      const rid = `${swimGroup.id}.__conc_region__${i}`;
      const pos = layout1.groups?.[rid];
      orderData.push({ regionIdx: i, repNodeId: regions[i][0], x: pos?.x ?? 0 });
    }
    orderData.sort((a, b) => a.x - b.x);
    swimlaneSpineOrder = orderData;
  }

  // Main pass (with spine ordering if swimlane)
  const { dot: dotRaw, groupIds } = layoutGraphToDot(rootNodes, model, renderers, theme, swimlaneSpineOrder);
  const dot = injectOrtho(dotRaw);

  // 4. Render via viz.js (JSON output = pos/width/height, no xdot draw ops)
  let vizJson = await renderViz(dot);

  // 5. Extract + transform coordinates
  const layout = extractLayout(vizJson, renderers, model.edges, groupIds, theme.padXS);

  // 5.0 Strip spine nodes/edges and shift content up
  if (swimlaneSpineOrder && swimlaneSpineOrder.length > 0) {
    // Remove spine nodes
    for (const key of Object.keys(layout.nodes)) {
      if (key.startsWith('__spine_')) delete layout.nodes[key];
    }
    // Filter spine edges
    if (layout.edges) {
      layout.edges = layout.edges.filter(e =>
        !e.from.startsWith('__spine_') && !e.to.startsWith('__spine_')
      );
    }
    // Shift all content up so minimum Y is 0
    const yValues: number[] = [];
    for (const n of Object.values(layout.nodes)) yValues.push(n.y);
    for (const g of Object.values(layout.groups || {})) yValues.push(g.y);
    const minY = yValues.length > 0 ? Math.min(...yValues) : 0;
    if (minY > 0) {
      for (const n of Object.values(layout.nodes)) {
        n.y -= minY;
        if (n.xlabelPos) n.xlabelPos.y -= minY;
      }
      for (const g of Object.values(layout.groups || {})) {
        g.y -= minY;
      }
      for (const e of layout.edges || []) {
        for (const pt of e.points || []) pt.y -= minY;
        if (e.labelPos) e.labelPos.y -= minY;
        if ((e as any).cardFromPos) (e as any).cardFromPos.y -= minY;
        if ((e as any).cardToPos) (e as any).cardToPos.y -= minY;
      }
    }
  }

  // 5a. Swimlane column rearrangement (if activity swimlanes present)
  rearrangeSwimlanes(layout, model, theme);

  // 5a2. Fix node spacing, ortho edges, and node collision avoidance for swimlane diagrams
  if (useOrtho) {
    fixNodeSpacing(layout, model, theme);
    fixOrthoEdges(layout, model);
    separateOverlappingEdges(layout, theme.padXS);
    avoidNodeCollisions(layout, model, theme);
    simplifyBacktrackEdges(layout, theme.padL);
  }

  // 5b. Snap port nodes to their parent group boundary
  snapPortNodes(layout, model, renderers, theme);

  // 6. Fine-tune field-targeting notes (memberTarget) Y alignment
  alignFieldNotes(layout.nodes, model.notes || [], model.nodes, theme);

  // 7. Position title above diagram with negative Y (not via DOT)
  positionTitle(layout, renderers);

  return { layout, renderers };
}
