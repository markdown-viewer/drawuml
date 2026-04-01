/**
 * ELK swimlane layout — compressed-layout algorithm
 *
 * Algorithm:
 *  1. For each lane Li, build an IDENTICAL ELK graph where:
 *     - Nodes belonging to Li: full width (own nodes)
 *     - Nodes NOT in Li: width = 0, height kept → ghost nodes that anchor the same
 *       layers without consuming horizontal space.
 *     - ALL edges use the same ELK form (labels included, minus layoutOptions for
 *       cross-lane edges) so LabelDummyInserter produces identical inter-layer
 *       spacing across all lanes → consistent Y coordinates for all nodes.
 *  2. Run ELK independently for each lane.
 *  3. Prune: keep own-lane node positions and intra-lane edge sections.
 *  4. Connect: route cross-lane edges using the orthogonal routing algorithm
 *     (routeEdgesBetweenLayers) — same algorithm used in DOT post-processing,
 *     applied "rotated 90°" where:
 *       - Y midpoints of nodes are the "connection coordinates"
 *       - Routing slots are X positions within the horizontal inter-lane gap
 *     This avoids manual crossX calculation and properly separates parallel
 *     edges between the same lane pair.
 */

import type { LayoutResult, LayoutNode, LayoutEdge, LayoutGroup } from '../../model/index.ts';
import type { SemanticModel, SemanticEdge } from '../../model/index.ts';
import { Renderer } from '../../primitives/renderer.ts';
import { createRenderers, buildRendererTree } from '../renderer-tree.ts';
import { createTheme, fontFamilyStyle, type Theme } from '../../shared/theme.ts';
import { cellId, escapeXml, n4 } from '../../shared/xml-utils.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { TextBlock } from '../../shared/text-block.ts';
import { getElk, type ElkLayoutResult } from './elk-engine.ts';
import { elkSpacing, collectEdges, type ElkEdge } from './elk-adapter.ts';
import { routeOrthogonalFixed } from '../orthogonal-router.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Per-lane layout result extracted from ELK output. */
interface LaneResult {
  laneIdx:   number;
  elkWidth:  number;
  elkHeight: number;
  /** Max (x + width) of own-lane nodes only — used for lane column sizing. */
  ownWidth:  number;
  /** Min x of own-lane nodes — used to strip left whitespace from ghost nodes. */
  minOwnX:   number;
  /** Min y of own-lane content (nodes + edge points + labels). */
  minOwnY:   number;
  /** Max y+h of own-lane content (nodes + edge points + labels). */
  maxOwnY:   number;
  /** Positions of nodes that BELONG to this lane (local to lane container). */
  nodePos:   Map<string, { x: number; y: number }>;
  /** ELK sections for intra-lane edges (local to lane container). */
  edgeSecs:  Map<string, any[]>;
  /** ELK label info for intra-lane edges. */
  edgeLabels: Map<string, { labelPos?: { x: number; y: number }; labelSize?: { width: number; height: number } }>;
  /**
   * Port X positions from ELK for cross-lane edges where this lane owns one endpoint.
   * key = edgeId, value = { fromX } when srcLane===li (own source), { toX } when tgtLane===li (own target).
   * These are local to the lane container coordinate system and must be offset by globalX.
   */
  crossEdgePts: Map<string, { fromX?: number; toX?: number }>;
  /** Global x offset assigned in step 4. */
  globalX:   number;
}

// ---------------------------------------------------------------------------
// Step 1 helper — build a single ELK graph for one lane
// ---------------------------------------------------------------------------

function buildLaneGraph(
  li: number,
  regions: string[][],
  nodeLaneIdx: Map<string, number>,
  allEdges: SemanticEdge[],
  elkEdgeById: Map<string, ElkEdge>,
  renderers: Map<string, Renderer>,
  theme: Theme,
  es: ReturnType<typeof elkSpacing>,
) {
  const laneNodeSet = new Set(regions[li]);

  // Build ELK children: own nodes = full size, foreign nodes = width 0.
  // Foreign nodes keep their height so ELK assigns every lane the same layers.
  // The graph topology is IDENTICAL across all lanes; only own-node widths differ.
  // This guarantees consistent Y positions across lanes.
  const children = Array.from(nodeLaneIdx.keys()).map(nid => {
    const r = renderers.get(nid);
    const m = r ? r.measure() : { width: 120, height: 40 };
    return { id: nid, width: laneNodeSet.has(nid) ? m.width : 1, height: m.height };
  });

  // All model edges — identical labels for every lane, to ensure consistent
  // inter-layer spacing (ELK's LabelDummyInserter uses label heights to
  // determine layer-to-layer distance).
  //
  // Intra-lane edges: full ELK form (sources/targets/labels/layoutOptions).
  // Cross-lane edges: bare form + labels only (no layoutOptions).
  //   - Labels preserve spacing parity with the owner lane.
  //   - Omitting layoutOptions (esp. edgeLabels.inline) prevents ELK from
  //     routing ghost→ghost inline labels, which would corrupt intra-lane routing.
  const edges = allEdges.map(e => {
    const full = elkEdgeById.get(e.id);
    const srcLane = nodeLaneIdx.get(e.from);
    const tgtLane = nodeLaneIdx.get(e.to);
    if (srcLane === li && tgtLane === li) {
      // Intra-lane: full ELK form including routing options
      return full ?? { id: e.id, sources: [e.from], targets: [e.to] };
    }
    // Cross-lane: bare + labels only for spacing consistency
    const bare: { id: string; sources: string[]; targets: string[]; labels?: any[] } =
      { id: e.id, sources: [e.from], targets: [e.to] };
    if (full?.labels?.length) bare.labels = full.labels;
    return bare;
  });

  const laneId = `__sw_lane_${li}`;

  // Wrap the lane container in a thin root so the lane CONTAINER can have ports
  // if needed in the future. ELK does not allow ports on the layout root itself.
  return {
    id: `__lane_root_${li}`,
    layoutOptions: {
      'elk.algorithm': 'box',
      'elk.padding':   '[top=0,right=0,bottom=0,left=0]',
      'elk.spacing.nodeNode': '0',
    },
    children: [{
      id: laneId,
      layoutOptions: {
        'elk.algorithm':                                    'layered',
        'elk.direction':                                    'DOWN',
        'elk.edgeRouting':                                  'ORTHOGONAL',
        'elk.spacing.nodeNode':                             es.nodeNode,
        'elk.layered.spacing.nodeNodeBetweenLayers':        es.nodeNodeBetweenLayers,
        'elk.spacing.edgeNode':                             es.edgeNode,
        'elk.spacing.edgeEdge':                             es.edgeEdge,
        'elk.spacing.nodeSelfLoop':                         es.nodeSelfLoop,
        'elk.layered.spacing.edgeEdgeBetweenLayers':        es.edgeEdgeBetweenLayers,
        'elk.layered.spacing.edgeNodeBetweenLayers':        es.edgeNodeBetweenLayers,
        'elk.layered.considerModelOrder.strategy':          'NODES_AND_EDGES',
        'elk.layered.compaction.postCompaction.strategy':   'CONSERVATIVE',
        'elk.padding':                                      '[top=0,left=0,bottom=0,right=0]',
      },
      children,
      edges,
    }],
    edges: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lay out an activity swimlane diagram using the compressed-layout algorithm.
 * Each lane gets its own full-graph ELK run; foreign nodes are ghost (width=0)
 * so layer assignments are consistent across lanes without manual alignment.
 */
export async function elkSwimlaneLayout2(
  model: SemanticModel,
  options?: { theme?: Theme },
): Promise<ElkLayoutResult> {
  const theme     = options?.theme ?? createTheme();
  const renderers = createRenderers(model, { theme });
  buildRendererTree(model, renderers, { theme });

  const swimContainer = (model.groups || []).find(
    g => g.type === 'swimlane_container' && g.concurrentRegions && g.concurrentRegions.length > 1,
  );
  if (!swimContainer) {
    return { layout: { nodes: {}, edges: [] }, renderers };
  }

  const regions  = swimContainer.concurrentRegions!;
  const numLanes = regions.length;

  // node → lane index
  const nodeLaneIdx = new Map<string, number>();
  for (let li = 0; li < numLanes; li++)
    for (const nid of regions[li]) nodeLaneIdx.set(nid, li);

  const allEdges    = model.edges;
  const elkEdgeById = new Map<string, ElkEdge>(
    collectEdges(model, renderers, theme).map(e => [e.id, e]),
  );

  const crossEdges = allEdges.filter(e => {
    const sl = nodeLaneIdx.get(e.from);
    const tl = nodeLaneIdx.get(e.to);
    return sl !== undefined && tl !== undefined && sl !== tl;
  });

  const intraEdgesByLane: SemanticEdge[][] = Array.from({ length: numLanes }, () => []);
  for (const e of allEdges) {
    const sl = nodeLaneIdx.get(e.from);
    const tl = nodeLaneIdx.get(e.to);
    if (sl !== undefined && tl !== undefined && sl === tl) intraEdgesByLane[sl].push(e);
  }

  const es  = elkSpacing(theme);
  const elk = getElk();

  // ─── Step 1–2: run ELK independently for each lane ───────────────────────
  const laneResults: LaneResult[] = [];

  for (let li = 0; li < numLanes; li++) {
    const graph  = buildLaneGraph(li, regions, nodeLaneIdx, allEdges, elkEdgeById, renderers, theme, es);
    const root   = await elk.layout(graph) as any;
    // Lane container is the only child of the thin wrapper root
    const gc     = (root.children || [])[0] as any ?? {};

    const lr: LaneResult = {
      laneIdx:    li,
      elkWidth:   gc.width  ?? 0,
      elkHeight:  gc.height ?? 0,
      ownWidth:   0,
      minOwnX:    Infinity,
      minOwnY:    Infinity,
      maxOwnY:    0,
      nodePos:    new Map(),
      edgeSecs:   new Map(),
      edgeLabels: new Map(),
      crossEdgePts: new Map(),
      globalX:    0,
    };

    // ─── Step 3: prune — keep own-lane nodes and intra-lane edge sections ────
    const laneNodeSet  = new Set(regions[li]);
    const intraEdgeSet = new Set(intraEdgesByLane[li].map(e => e.id));

    for (const n of (gc.children || []) as any[]) {
      if (laneNodeSet.has(n.id)) {
        lr.nodePos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
        // Use renderer measure() for width/height (ELK may report ghost-inflated values)
        const _r = renderers.get(n.id);
        const _m = _r ? _r.measure() : { width: n.width ?? 0, height: n.height ?? 0 };
        const _nx = n.x ?? 0;
        const _ny = n.y ?? 0;
        if (_nx < lr.minOwnX) lr.minOwnX = _nx;
        if (_nx + _m.width > lr.ownWidth) lr.ownWidth = _nx + _m.width;
        if (_ny < lr.minOwnY) lr.minOwnY = _ny;
        if (_ny + _m.height > lr.maxOwnY) lr.maxOwnY = _ny + _m.height;
      }
    }

    for (const e of (gc.edges || []) as any[]) {
      if (!intraEdgeSet.has(e.id)) continue;
      lr.edgeSecs.set(e.id, e.sections || []);
      // Track x/y extents from edge routing points
      for (const s of (e.sections || []) as any[]) {
        const pts = [s.startPoint, ...(s.bendPoints || []), s.endPoint].filter(Boolean);
        for (const p of pts) {
          if (p.x < lr.minOwnX) lr.minOwnX = p.x;
          if (p.x > lr.ownWidth) lr.ownWidth = p.x;
          if (p.y < lr.minOwnY) lr.minOwnY = p.y;
          if (p.y > lr.maxOwnY) lr.maxOwnY = p.y;
        }
      }
      const lblInfo: { labelPos?: { x: number; y: number }; labelSize?: { width: number; height: number } } = {};
      for (const lbl of (e.labels || []) as any[]) {
        if (lbl.x !== undefined && lbl.y !== undefined && lbl.placement !== 'tail' && lbl.placement !== 'head') {
          lblInfo.labelPos  = { x: lbl.x + (lbl.width ?? 0) / 2, y: lbl.y + (lbl.height ?? 0) / 2 };
          lblInfo.labelSize = { width: Math.ceil(lbl.width ?? 0), height: Math.ceil(lbl.height ?? 0) };
        }
        // Track x/y extents from edge labels
        if (lbl.x !== undefined) {
          if (lbl.x < lr.minOwnX) lr.minOwnX = lbl.x;
          const lblRight = lbl.x + (lbl.width ?? 0);
          if (lblRight > lr.ownWidth) lr.ownWidth = lblRight;
        }
        if (lbl.y !== undefined) {
          if (lbl.y < lr.minOwnY) lr.minOwnY = lbl.y;
          const lblBottom = lbl.y + (lbl.height ?? 0);
          if (lblBottom > lr.maxOwnY) lr.maxOwnY = lblBottom;
        }
      }
      lr.edgeLabels.set(e.id, lblInfo);
    }

    // Collect cross-lane edge port X from the lane run that OWNS each endpoint.
    // ELK routes every edge (including cross-lane ones) within each lane run, so
    // the own-endpoint port is computed correctly considering all edges of that node.
    // We capture it here to pass as a hint to routeOrthogonalFixed later.
    for (const e of (gc.edges || []) as any[]) {
      if (intraEdgeSet.has(e.id)) continue; // intra-lane already handled above
      const sec = (e.sections || [])[0] as any;
      if (!sec) continue;
      const srcLane = nodeLaneIdx.get(e.sources?.[0]);
      const tgtLane = nodeLaneIdx.get(e.targets?.[0]);
      const existing = lr.crossEdgePts.get(e.id) ?? {};
      if (srcLane === li && sec.startPoint?.x !== undefined) {
        lr.crossEdgePts.set(e.id, { ...existing, fromX: sec.startPoint.x });
      }
      if (tgtLane === li && sec.endPoint?.x !== undefined) {
        lr.crossEdgePts.set(e.id, { ...existing, toX: sec.endPoint.x });
      }
    }

    laneResults.push(lr);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3.5: Group discovery + centering
  // ─────────────────────────────────────────────────────────────────────────
  // When a lane has disconnected node groups (connected components via
  // intra-lane edges), each group may sit at a different x position due to
  // ghost-node layout artifacts.  Discover groups, merge those with
  // overlapping Y ranges, then center each group within the lane.
  for (let li = 0; li < numLanes; li++) {
    const lr = laneResults[li];
    const ownNodes = regions[li];
    if (ownNodes.length <= 1) continue;

    // --- Union-Find on intra-lane edges ---
    const ufParent = new Map<string, string>();
    for (const nid of ownNodes) ufParent.set(nid, nid);
    const ufFind = (a: string): string => {
      while (ufParent.get(a) !== a) { ufParent.set(a, ufParent.get(ufParent.get(a)!)!); a = ufParent.get(a)!; }
      return a;
    };
    const ufUnion = (a: string, b: string) => { ufParent.set(ufFind(a), ufFind(b)); };

    for (const e of intraEdgesByLane[li]) {
      if (ufParent.has(e.from) && ufParent.has(e.to)) ufUnion(e.from, e.to);
    }

    // Collect groups: root → node IDs (only nodes with positions)
    const groupMembers = new Map<string, string[]>();
    for (const nid of ownNodes) {
      if (!lr.nodePos.has(nid)) continue;
      const root = ufFind(nid);
      if (!groupMembers.has(root)) groupMembers.set(root, []);
      groupMembers.get(root)!.push(nid);
    }
    if (groupMembers.size <= 1) continue;

    // Node → group root
    const nodeGroup = new Map<string, string>();
    for (const [root, members] of Array.from(groupMembers))
      for (const nid of members) nodeGroup.set(nid, root);

    // Compute Y range per group (from nodes, for merge decisions)
    const groupYRange = new Map<string, { minY: number; maxY: number }>();
    for (const [root, members] of Array.from(groupMembers)) {
      let minY = Infinity, maxY = -Infinity;
      for (const nid of members) {
        const pos = lr.nodePos.get(nid)!;
        const h = renderers.get(nid)?.measure().height ?? 40;
        if (pos.y < minY) minY = pos.y;
        if (pos.y + h > maxY) maxY = pos.y + h;
      }
      groupYRange.set(root, { minY, maxY });
    }

    // Merge groups with overlapping Y ranges (sort by minY, sweep)
    let roots = Array.from(groupMembers.keys());
    roots.sort((a, b) => groupYRange.get(a)!.minY - groupYRange.get(b)!.minY);
    let didMerge = true;
    while (didMerge) {
      didMerge = false;
      for (let i = 0; i < roots.length - 1; i++) {
        const ra = roots[i], rb = roots[i + 1];
        const ya = groupYRange.get(ra)!, yb = groupYRange.get(rb)!;
        if (yb.minY <= ya.maxY) {
          groupMembers.get(ra)!.push(...groupMembers.get(rb)!);
          for (const nid of groupMembers.get(rb)!) nodeGroup.set(nid, ra);
          groupYRange.set(ra, { minY: Math.min(ya.minY, yb.minY), maxY: Math.max(ya.maxY, yb.maxY) });
          groupMembers.delete(rb); groupYRange.delete(rb);
          roots.splice(i + 1, 1);
          didMerge = true;
          break;
        }
      }
    }
    if (groupMembers.size <= 1) continue;

    // Edge → group root
    const edgeGroup = new Map<string, string>();
    for (const e of intraEdgesByLane[li]) {
      const g = nodeGroup.get(e.from);
      if (g) edgeGroup.set(e.id, g);
    }

    // Compute X extent per group (nodes + edge routing points + labels)
    const groupXRange = new Map<string, { minX: number; maxX: number }>();
    for (const [root, members] of Array.from(groupMembers)) {
      let minX = Infinity, maxX = -Infinity;
      for (const nid of members) {
        const pos = lr.nodePos.get(nid)!;
        const w = renderers.get(nid)?.measure().width ?? 120;
        if (pos.x < minX) minX = pos.x;
        if (pos.x + w > maxX) maxX = pos.x + w;
      }
      groupXRange.set(root, { minX, maxX });
    }
    for (const e of intraEdgesByLane[li]) {
      const g = edgeGroup.get(e.id);
      if (!g) continue;
      const xr = groupXRange.get(g)!;
      for (const s of (lr.edgeSecs.get(e.id) ?? []) as any[]) {
        for (const p of [s.startPoint, ...(s.bendPoints || []), s.endPoint].filter(Boolean)) {
          if (p.x < xr.minX) xr.minX = p.x;
          if (p.x > xr.maxX) xr.maxX = p.x;
        }
      }
      const lbl = lr.edgeLabels.get(e.id);
      if (lbl?.labelPos && lbl.labelSize) {
        const lblL = lbl.labelPos.x - lbl.labelSize.width / 2;
        const lblR = lbl.labelPos.x + lbl.labelSize.width / 2;
        if (lblL < xr.minX) xr.minX = lblL;
        if (lblR > xr.maxX) xr.maxX = lblR;
      }
    }

    // Lane content width = widest group
    const laneContentW = Math.max(...Array.from(groupXRange.values()).map(xr => xr.maxX - xr.minX));

    // Per-group centering shift:
    //   desired left = (laneContentW - groupWidth) / 2
    //   current left = groupMinX
    //   shift = desired - current
    const groupShift = new Map<string, number>();
    for (const [root, xr] of Array.from(groupXRange)) {
      const gw = xr.maxX - xr.minX;
      groupShift.set(root, (laneContentW - gw) / 2 - xr.minX);
    }

    // Apply shifts to node positions
    for (const [nid, pos] of Array.from(lr.nodePos)) {
      const g = nodeGroup.get(nid);
      if (g) pos.x += groupShift.get(g)!;
    }

    // Apply shifts to intra-lane edge sections and labels
    for (const e of intraEdgesByLane[li]) {
      const g = edgeGroup.get(e.id);
      if (!g) continue;
      const shift = groupShift.get(g)!;
      for (const s of (lr.edgeSecs.get(e.id) ?? []) as any[]) {
        if (s.startPoint) s.startPoint.x += shift;
        if (s.endPoint) s.endPoint.x += shift;
        for (const bp of (s.bendPoints || []) as any[]) bp.x += shift;
      }
      const lbl = lr.edgeLabels.get(e.id);
      if (lbl?.labelPos) lbl.labelPos.x += shift;
    }

    // Apply shifts to cross-lane edge port hints
    for (const [eid, pts] of Array.from(lr.crossEdgePts)) {
      const eData = allEdges.find(e => e.id === eid);
      if (!eData) continue;
      if (pts.fromX !== undefined && nodeLaneIdx.get(eData.from) === li) {
        const g = nodeGroup.get(eData.from);
        if (g) pts.fromX += groupShift.get(g)!;
      }
      if (pts.toX !== undefined && nodeLaneIdx.get(eData.to) === li) {
        const g = nodeGroup.get(eData.to);
        if (g) pts.toX += groupShift.get(g)!;
      }
    }

    // Recalculate lane extents from shifted positions
    lr.minOwnX = Infinity; lr.ownWidth = 0;
    lr.minOwnY = Infinity; lr.maxOwnY = 0;
    for (const [nid, pos] of Array.from(lr.nodePos)) {
      const m = renderers.get(nid)?.measure() ?? { width: 120, height: 40 };
      if (pos.x < lr.minOwnX) lr.minOwnX = pos.x;
      if (pos.x + m.width > lr.ownWidth) lr.ownWidth = pos.x + m.width;
      if (pos.y < lr.minOwnY) lr.minOwnY = pos.y;
      if (pos.y + m.height > lr.maxOwnY) lr.maxOwnY = pos.y + m.height;
    }
    for (const e of intraEdgesByLane[li]) {
      for (const s of (lr.edgeSecs.get(e.id) ?? []) as any[]) {
        for (const p of [s.startPoint, ...(s.bendPoints || []), s.endPoint].filter(Boolean)) {
          if (p.x < lr.minOwnX) lr.minOwnX = p.x;
          if (p.x > lr.ownWidth) lr.ownWidth = p.x;
          if (p.y < lr.minOwnY) lr.minOwnY = p.y;
          if (p.y > lr.maxOwnY) lr.maxOwnY = p.y;
        }
      }
      const lbl = lr.edgeLabels.get(e.id);
      if (lbl?.labelPos && lbl.labelSize) {
        const lblL = lbl.labelPos.x - lbl.labelSize.width / 2;
        const lblR = lbl.labelPos.x + lbl.labelSize.width / 2;
        if (lblL < lr.minOwnX) lr.minOwnX = lblL;
        if (lblR > lr.ownWidth) lr.ownWidth = lblR;
        const lblT = lbl.labelPos.y - lbl.labelSize.height / 2;
        const lblB = lbl.labelPos.y + lbl.labelSize.height / 2;
        if (lblT < lr.minOwnY) lr.minOwnY = lblT;
        if (lblB > lr.maxOwnY) lr.maxOwnY = lblB;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Lane column x positions
  // ─────────────────────────────────────────────────────────────────────────
  // Lane width = content extent + 2 * pad.  Content extent = ownWidth - minOwnX
  // (stripping ghost-node-induced left offset).  pad ensures uniform padding on
  // both sides regardless of where ELK placed own nodes internally.
  const pad = theme.groupPad;
  // Measure lane title widths — title must fit within the lane
  const titleFont = { family: theme.fontFamily, size: theme.smallFontSize };
  const titleMinWidths = regions.map((_r, li) => {
    const label = swimContainer.concurrentRegionLabels?.[li] || '';
    if (!label) return 0;
    return TextBlock.literal(label, titleFont).measure().width + 2 * theme.edgeGap;
  });
  const laneWidths = laneResults.map((lr, li) => {
    const minX = isFinite(lr.minOwnX) ? lr.minOwnX : 0;
    const contentW = (lr.ownWidth - minX) + 2 * pad;
    return Math.max(contentW, titleMinWidths[li]);
  });
  const laneXStart: number[] = [0];
  for (let i = 1; i < numLanes; i++)
    laneXStart.push(laneXStart[i - 1] + laneWidths[i - 1]);

  // Shift so content is centered within lane width.
  for (const lr of laneResults) {
    const minX = isFinite(lr.minOwnX) ? lr.minOwnX : 0;
    lr.globalX = laneXStart[lr.laneIdx] + (laneWidths[lr.laneIdx] - (lr.ownWidth - minX)) / 2 - minX;
  }

  const titleBarOffset = theme.titleBarH;
  // Compute totalH from actual content Y extent (not elkHeight which may have extra space).
  // All lanes share the same layer assignment so minOwnY should be consistent,
  // but we use the global min/max to be safe.
  const globalMinY = Math.min(...laneResults.map(lr => isFinite(lr.minOwnY) ? lr.minOwnY : 0));
  const globalMaxY = Math.max(...laneResults.map(lr => lr.maxOwnY));
  const contentH = (globalMaxY - globalMinY) + 2 * pad;
  const totalH = Math.max(contentH, 100) + titleBarOffset;
  // Y offset: strip ELK internal top offset, apply uniform pad
  const globalDy = titleBarOffset + pad - globalMinY;
  const totalW = laneXStart[numLanes - 1] + laneWidths[numLanes - 1];

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Build LayoutResult
  // ─────────────────────────────────────────────────────────────────────────

  // --- Nodes ---
  const nodes: Record<string, LayoutNode> = {};
  for (const lr of laneResults) {
    for (const [nid, lp] of Array.from(lr.nodePos)) {
      const r  = renderers.get(nid);
      const sz = r ? r.measure() : { width: 120, height: 40 };
      nodes[nid] = {
        id:     nid,
        x:      lr.globalX + lp.x,
        y:      globalDy + lp.y,
        width:  sz.width,
        height: sz.height,
      };
    }
  }

  // --- Edges ---
  const sectionsToPoints = (sections: any[], dx: number, dy: number) => {
    const pts: Array<{ x: number; y: number }> = [];
    for (const s of sections) {
      const raw = [s.startPoint, ...(s.bendPoints || []), s.endPoint].filter(Boolean);
      for (let i = 0; i < raw.length; i++) {
        if (i === 0 && pts.length > 0) continue;
        pts.push({ x: dx + raw[i].x, y: dy + raw[i].y });
      }
    }
    return pts;
  };

  const layoutEdges: LayoutEdge[] = [];

  // Intra-lane edges
  for (const lr of laneResults) {
    const dx = lr.globalX;
    const dy = globalDy;
    for (const e of intraEdgesByLane[lr.laneIdx]) {
      const sections = lr.edgeSecs.get(e.id) ?? [];
      const points   = sectionsToPoints(sections, dx, dy);
      const lbl      = lr.edgeLabels.get(e.id);
      const labelPos  = lbl?.labelPos ? { x: lbl.labelPos.x + dx, y: lbl.labelPos.y + dy } : undefined;
      layoutEdges.push({ id: e.id, from: e.from, to: e.to, points: points.length >= 2 ? points : undefined, labelPos, labelSize: lbl?.labelSize });
    }
  }

  // ─── Connect cross-lane edges via routeOrthogonalFixed ────────────────────
  // Push cross-lane edges without any routing points. The orthogonal router
  // (TB mode) will detect them as cross-layer edges and route them through
  // the horizontal gaps between lane columns. Intra-lane edges already have
  // ELK-computed points and share the same layer, so the router skips them.
  for (const ce of crossEdges) {
    const le: LayoutEdge = { id: ce.id, from: ce.from, to: ce.to };
    // Attach label size so the orthogonal router can position labels
    const elkE = elkEdgeById.get(ce.id);
    if (elkE?.labels) {
      for (const lbl of elkE.labels) {
        if ((lbl as any).placement === 'center' && lbl.width && lbl.height) {
          le.labelPos = { x: 0, y: 0 }; // placeholder — router will reposition
          le.labelSize = { width: lbl.width, height: lbl.height };
        }
      }
    }
    layoutEdges.push(le);
  }

  // Compile ELK-computed port X hints for cross-lane edges.
  // For each edge, the source port comes from the source lane's run (own source node),
  // and the target port from the target lane's run (own target node).
  // Convert from lane-local to global X by adding lr.globalX.
  const portHints = new Map<string, { fromX?: number; toX?: number }>();
  for (const ce of crossEdges) {
    const srcLane = nodeLaneIdx.get(ce.from)!;
    const tgtLane = nodeLaneIdx.get(ce.to)!;
    const fromPt = laneResults[srcLane]?.crossEdgePts.get(ce.id);
    const toPt   = laneResults[tgtLane]?.crossEdgePts.get(ce.id);
    const hint: { fromX?: number; toX?: number } = {};
    if (fromPt?.fromX !== undefined) hint.fromX = laneResults[srcLane].globalX + fromPt.fromX;
    if (toPt?.toX   !== undefined) hint.toX   = laneResults[tgtLane].globalX + toPt.toX;
    if (hint.fromX !== undefined || hint.toX !== undefined) portHints.set(ce.id, hint);
  }

  // --- Lane container groups ---
  const groups: Record<string, LayoutGroup> = {};
  groups[swimContainer.id] = { id: swimContainer.id, x: 0, y: 0, width: totalW, height: totalH };
  for (let li = 0; li < numLanes; li++) {
    const rid = `${swimContainer.id}.__conc_region__${li}`;
    groups[rid] = { id: rid, x: laneXStart[li], y: 0, width: laneWidths[li], height: totalH };
  }

  // --- Generate swimlane background cells (prefixCells) ---
  // Instead of relying on SwimlaneContainerRenderer's proportional allocation,
  // emit lane rectangles directly using exact layout coordinates.
  const prefixCells: string[] = [];
  // Invisible container group
  prefixCells.push(
    `<mxCell id="${escapeXml(cellId(swimContainer.id))}" value="" `
    + `style="group;strokeColor=none;fillColor=none;" `
    + `vertex="1" parent="1">`
    + `<mxGeometry x="0" y="0" width="${n4(totalW)}" height="${n4(totalH)}" as="geometry"/>`
    + `</mxCell>`,
  );
  // Lane rectangles
  for (let li = 0; li < numLanes; li++) {
    const rid = `${swimContainer.id}.__conc_region__${li}`;
    const label = swimContainer.concurrentRegionLabels?.[li] || '';
    const color = swimContainer.concurrentRegionColors?.[li] || '';
    const startSize = label ? theme.titleBarH : 0;
    const fill = normalizeColor(color) || theme.groupFill;
    const style = `swimlane;html=1;startSize=${startSize};`
      + `collapsible=0;rounded=0;`
      + `strokeWidth=${theme.strokeWidth};fillColor=${fill};swimlaneFillColor=${fill};strokeColor=${theme.colorDark};`
      + `fontStyle=0;fontSize=${theme.smallFontSize};${fontFamilyStyle(theme)}`;
    prefixCells.push(
      `<mxCell id="${escapeXml(cellId(rid))}" value="${escapeXml(label)}" style="${style}" `
      + `vertex="1" parent="${escapeXml(cellId(swimContainer.id))}">`
      + `<mxGeometry x="${n4(laneXStart[li])}" y="0" width="${n4(laneWidths[li])}" height="${n4(totalH)}" as="geometry"/>`
      + `</mxCell>`,
    );
  }

  // --- Flatten renderer tree ---
  // Detach all node renderers from ConcurrentRegionRenderer parents so they
  // become root-level and get rendered directly by drawio-gen with exact
  // absolute coordinates from ELK layout.
  const swimR = renderers.get(swimContainer.id);
  if (swimR) {
    for (const regionR of swimR.children) {
      for (const child of regionR.children) {
        child.parentId = undefined;
      }
    }
  }
  // Remove container/region renderers — their cells are now in prefixCells
  renderers.delete(swimContainer.id);
  for (let li = 0; li < numLanes; li++) {
    renderers.delete(`${swimContainer.id}.__conc_region__${li}`);
  }

  const layout: LayoutResult = { nodes, edges: layoutEdges, groups, prefixCells };

  // Pre-expand vertical gaps so cross-lane edge routing has enough room.
  // adjustNodeSpacing inside the orthogonal router is skipped when fixedNodes=true,
  // so we replicate the logic here before routing, also shifting intra-lane
  // edge points and group/prefixCell heights accordingly.
  adjustCrossLaneSpacing(layout, crossEdges, nodeLaneIdx, theme);

  // Route cross-lane edges: node positions are fixed, intra-lane edges already
  // have points (same X-layer → skipped). Cross-lane edges span lane columns
  // (different X-layers) → routed through the inter-lane gap.
  // portHints carry the ELK-computed port X positions so that nodes with multiple
  // cross-lane edges get the correct (non-center) connection points.
  routeOrthogonalFixed(layout, theme, portHints.size > 0 ? portHints : undefined);

  return { layout, renderers };
}

// ---------------------------------------------------------------------------
// Pre-routing: expand vertical gaps for cross-lane edge trunks
// ---------------------------------------------------------------------------

// Larger than orthogonal-router's 5 because swimlane nodes at the same logical
// level can have different heights (e.g. thin fork bars ~7px vs activity nodes
// ~46px), causing center offsets up to ~20px.  15 safely merges same-level
// nodes while staying well below the typical inter-layer gap (50px+).
const LAYER_TOLERANCE = 15;

/**
 * Compute Y-layers from node positions (same logic as orthogonal-router's
 * buildLayers, but inlined to avoid exporting internal helpers).
 */
function buildYLayers(nodes: Record<string, LayoutNode>): string[][] {
  const coords: { id: string; center: number }[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    coords.push({ id, center: node.y + node.height / 2 });
  }
  coords.sort((a, b) => a.center - b.center);

  const layers: { center: number; nodes: string[] }[] = [];
  for (const { id, center } of coords) {
    let found = false;
    for (const layer of layers) {
      if (Math.abs(center - layer.center) <= LAYER_TOLERANCE) {
        layer.nodes.push(id);
        found = true;
        break;
      }
    }
    if (!found) layers.push({ center, nodes: [id] });
  }
  return layers.map(l => l.nodes);
}

/**
 * Ensure there is enough vertical space between node layers for cross-lane
 * edge trunks. When the gap is too small, shift all nodes/edges/groups in
 * lower layers downward and update totalH / prefixCells.
 */
function adjustCrossLaneSpacing(
  layout: LayoutResult,
  crossEdges: SemanticEdge[],
  nodeLaneIdx: Map<string, number>,
  theme: Theme,
): void {
  const nodes = layout.nodes;
  const edges = layout.edges;
  if (!edges || edges.length === 0) return;

  const edgeEdge = theme.edgeGap;
  const edgeNode = theme.nodeGap;

  const layers = buildYLayers(nodes);
  if (layers.length < 2) return;

  // nodeId → layerIndex
  const nodeLayerIndex = new Map<string, number>();
  for (let li = 0; li < layers.length; li++) {
    for (const nid of layers[li]) nodeLayerIndex.set(nid, li);
  }

  const numGaps = layers.length - 1;

  // Count cross-lane edges that need a horizontal trunk in each gap.
  // An edge has a trunk endpoint in gap gi if gi === srcLayer or gi+1 === tgtLayer.
  const gapTrunkCount = new Array(numGaps).fill(0) as number[];
  const gapHasTrunk = new Array(numGaps).fill(false) as boolean[];

  for (const ce of crossEdges) {
    let srcLayer = nodeLayerIndex.get(ce.from);
    let tgtLayer = nodeLayerIndex.get(ce.to);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer > tgtLayer) { const tmp = srcLayer; srcLayer = tgtLayer; tgtLayer = tmp; }
    if (srcLayer === tgtLayer) continue;

    for (let gi = srcLayer; gi < tgtLayer; gi++) {
      if (gi === srcLayer || gi + 1 === tgtLayer) {
        gapTrunkCount[gi]++;
        gapHasTrunk[gi] = true;
      }
    }
  }

  // Compute layer extents (bottom of layer i, top of layer i+1)
  const layerBottom: number[] = [];
  const layerTop: number[] = [];
  for (let li = 0; li < layers.length; li++) {
    let maxB = -Infinity, minT = Infinity;
    for (const nid of layers[li]) {
      const n = nodes[nid];
      if (!n) continue;
      minT = Math.min(minT, n.y);
      maxB = Math.max(maxB, n.y + n.height);
    }
    layerBottom.push(maxB);
    layerTop.push(minT);
  }

  // Compute per-gap delta
  const gapDelta: number[] = [];
  let anyPositive = false;
  for (let gi = 0; gi < numGaps; gi++) {
    if (!gapHasTrunk[gi]) { gapDelta.push(0); continue; }
    const actual = layerTop[gi + 1] - layerBottom[gi];
    const desired = edgeNode + gapTrunkCount[gi] * edgeEdge + edgeNode;
    const delta = Math.max(0, desired - actual);
    gapDelta.push(delta);
    if (delta > 0) anyPositive = true;
  }

  if (!anyPositive) return;

  // Build cumulative shift per layer (layer 0 stays)
  const cumShift: number[] = [0];
  let cum = 0;
  for (let li = 1; li < layers.length; li++) {
    cum += gapDelta[li - 1];
    cumShift.push(cum);
  }

  // Shift nodes
  for (let li = 1; li < layers.length; li++) {
    const shift = cumShift[li];
    if (shift === 0) continue;
    for (const nid of layers[li]) {
      const n = nodes[nid];
      if (n) n.y += shift;
    }
  }

  // Shift intra-lane edge points (those that already have routing from ELK).
  // Each point's Y gets the cumulative shift of the layer it falls into.
  // We locate the layer by checking which layer gap the point sits in.
  for (const edge of edges) {
    if (!edge.points || edge.points.length < 2) continue;
    for (const pt of edge.points) {
      // Find the layer whose bottom is just above (or at) this point
      let bestLi = 0;
      for (let li = 0; li < layers.length; li++) {
        if (layerTop[li] <= pt.y + LAYER_TOLERANCE) bestLi = li;
      }
      pt.y += cumShift[bestLi];
    }
    // Shift label positions too
    if (edge.labelPos) {
      let bestLi = 0;
      for (let li = 0; li < layers.length; li++) {
        if (layerTop[li] <= edge.labelPos.y + LAYER_TOLERANCE) bestLi = li;
      }
      edge.labelPos.y += cumShift[bestLi];
    }
  }

  const totalShift = cum;
  if (totalShift === 0) return;

  // Adjust groups
  if (layout.groups) {
    for (const g of Object.values(layout.groups)) {
      // Groups span the full height — just extend height
      g.height += totalShift;
    }
  }

  // Adjust prefixCells — update height values in the XML strings
  if (layout.prefixCells) {
    for (let i = 0; i < layout.prefixCells.length; i++) {
      layout.prefixCells[i] = layout.prefixCells[i].replace(
        /height="([^"]+)"/,
        (_match, oldH) => `height="${n4(parseFloat(oldH) + totalShift)}"`,
      );
    }
  }
}
