/**
 * ELK swimlane layout — border-port alignment algorithm
 *
 * Algorithm:
 *  1. For each swimlane group, BFS-partition nodes into connected sub-groups
 *     (using only intra-lane edges, ignoring cross-lane edges).
 *  2. For each cross-lane edge, add EAST/WEST border ports to the src/tgt sub-groups
 *     and connect: src_node → exit_port (inside src group)
 *                  entry_port → tgt_node (inside tgt group)
 *  3. Single ELK call: all sub-groups as children of root (SEPARATE_CHILDREN).
 *     Each sub-group is laid out with direction=DOWN independently.
 *  4. Align sub-groups vertically:
 *       tgtGrp.yStart = srcGrp.yStart + exitPort.localY - entryPort.localY
 *     Process in topological order; take max over all constraints.
 *     Enforce no vertical overlap within the same lane.
 *  5. Compute lane column x positions; assign each sub-group a globalX.
 *  6. Build LayoutResult:
 *     - Node positions: globalX + localX, yStart + localY
 *     - Group lane bounds: full lane column
 *     - Edge points: from ELK sections translated to global coords
 *       + cross-lane connection (horizontal segment between the two border ports)
 */

import type { LayoutResult, LayoutNode, LayoutEdge, LayoutGroup } from '../../model/index.ts';
import type { SemanticModel, SemanticEdge } from '../../model/index.ts';
import { Renderer } from '../../primitives/renderer.ts';
import { createRenderers, buildRendererTree } from '../renderer-tree.ts';
import { createTheme, type Theme } from '../../shared/theme.ts';
import { getElk, type ElkLayoutResult } from './elk-engine.ts';
import { elkSpacing, collectEdges, type ElkEdge } from './elk-adapter.ts';

// ---------------------------------------------------------------------------
// Constants & internal types
// ---------------------------------------------------------------------------

const LANE_PAD  = 20;  // horizontal padding inside each lane column
const LANE_GAP  = 40;  // gap between adjacent lane columns
const GRP_GAP   = 30;  // vertical gap between sub-groups in the same lane

interface SubGroup {
  id:          string;
  laneIdx:     number;
  nodes:       string[];              // node ids in this sub-group
  intraEdges:  SemanticEdge[];        // edges fully inside this sub-group
  bPorts:      Array<{ id: string; side: 'EAST' | 'WEST' }>;  // border ports
  bEdges:      Array<{ id: string; src: string; tgt: string }>;
  // filled after ELK layout:
  elkW:        number;
  elkH:        number;
  nodePos:     Map<string, { x: number; y: number }>;
  portPos:     Map<string, { x: number; y: number }>;
  edgeSecs:    Map<string, any[]>;    // edgeId → ELK sections[]
  edgeLabels:  Map<string, { labelPos?: { x: number; y: number }; labelSize?: { width: number; height: number } }>;
  // filled after alignment:
  yStart:      number;
  globalX:     number;
}

interface CrossPortInfo {
  exitPortId:  string;
  entryPortId: string;
  srcGrp:      SubGroup;
  tgtGrp:      SubGroup;
  ceId:        string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Lay out an activity-diagram swimlane model using the border-port alignment algorithm.
 * Returns a LayoutResult + renderer map compatible with the standard pipeline.
 */
export async function elkSwimlaneLayout(
  model: SemanticModel,
  options?: { theme?: Theme },
): Promise<ElkLayoutResult> {
  const theme     = options?.theme ?? createTheme();
  const renderers = createRenderers(model, { theme });
  buildRendererTree(model, renderers, { theme }); // populates SwimlaneContainerRenderer + ConcurrentRegionRenderer

  // Find the swimlane container group
  const swimContainer = (model.groups || []).find(
    g => g.type === 'swimlane_container' && g.concurrentRegions && g.concurrentRegions.length > 1,
  );
  if (!swimContainer) {
    // No swimlane — fall through to a simple result (caller should not call us in this case)
    return { layout: { nodes: {}, edges: [] }, renderers };
  }

  const regions     = swimContainer.concurrentRegions!;          // string[][] — one per lane
  const laneLabels  = swimContainer.concurrentRegionLabels ?? [];
  const numLanes    = regions.length;

  // node → lane index
  const nodeLaneIdx = new Map<string, number>();
  for (let li = 0; li < numLanes; li++)
    for (const nid of regions[li]) nodeLaneIdx.set(nid, li);

  // All edges in the model
  const allEdges = model.edges;

  // Pre-build ELK edge representations with label info for all model edges.
  // These are used in Step 3 so intra-lane edges carry label width/height/placement
  // and ELK can position them properly.
  const elkEdgeById = new Map<string, ElkEdge>(
    collectEdges(model, renderers, theme).map(e => [e.id, e]),
  );

  // Partition edges: cross-lane vs intra-lane
  const crossEdges: SemanticEdge[] = [];
  const intraEdgesByLane: SemanticEdge[][] = Array.from({ length: numLanes }, () => []);
  for (const e of allEdges) {
    const sli = nodeLaneIdx.get(e.from);
    const tli = nodeLaneIdx.get(e.to);
    if (sli === undefined || tli === undefined) continue;
    if (sli === tli) intraEdgesByLane[sli].push(e);
    else crossEdges.push(e);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1: BFS — connected sub-groups within each lane
  // ─────────────────────────────────────────────────────────────────────────
  const nodeToGrp = new Map<string, SubGroup>();
  const allSubGroups: SubGroup[] = [];

  for (let li = 0; li < numLanes; li++) {
    const laneNodes = regions[li];
    const adj       = new Map<string, string[]>(laneNodes.map(n => [n, []]));
    for (const e of intraEdgesByLane[li]) {
      adj.get(e.from)?.push(e.to);
      adj.get(e.to)?.push(e.from);
    }
    const visited = new Set<string>();
    let gi = 0;
    for (const startId of laneNodes) {
      if (visited.has(startId)) continue;
      const queue = [startId];
      const comp  = new Set<string>();
      while (queue.length) {
        const cur = queue.shift()!;
        if (visited.has(cur)) continue;
        visited.add(cur); comp.add(cur);
        for (const nb of adj.get(cur) || []) if (!visited.has(nb)) queue.push(nb);
      }
      const grp: SubGroup = {
        id:         `__sw_g_${li}_${gi++}`,
        laneIdx:    li,
        nodes:      Array.from(comp),
        intraEdges: intraEdgesByLane[li].filter(e => comp.has(e.from) && comp.has(e.to)),
        bPorts:     [],
        bEdges:     [],
        elkW: 0, elkH: 0,
        nodePos:   new Map(),
        portPos:   new Map(),
        edgeSecs:  new Map(),
        edgeLabels: new Map(),
        yStart:    0,
        globalX:   0,
      };
      allSubGroups.push(grp);
      for (const nid of Array.from(comp)) nodeToGrp.set(nid, grp);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 2: Add border ports + internal boundary edges for cross-lane edges
  // ─────────────────────────────────────────────────────────────────────────
  const cePortMap = new Map<string, CrossPortInfo>();

  for (const ce of crossEdges) {
    const srcGrp = nodeToGrp.get(ce.from);
    const tgtGrp = nodeToGrp.get(ce.to);
    if (!srcGrp || !tgtGrp) continue;

    const toRight    = tgtGrp.laneIdx > srcGrp.laneIdx;
    const exitPortId  = `__pex_${ce.id}`;
    const entryPortId = `__pen_${ce.id}`;

    srcGrp.bPorts.push({ id: exitPortId,  side: toRight ? 'EAST' : 'WEST' });
    srcGrp.bEdges.push({ id: `__ce_out_${ce.id}`, src: ce.from, tgt: exitPortId });

    tgtGrp.bPorts.push({ id: entryPortId, side: toRight ? 'WEST' : 'EAST' });
    tgtGrp.bEdges.push({ id: `__ce_in_${ce.id}`,  src: entryPortId, tgt: ce.to });

    cePortMap.set(ce.id, { exitPortId, entryPortId, srcGrp, tgtGrp, ceId: ce.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 3: Single ELK call — all sub-groups as siblings (SEPARATE_CHILDREN)
  // ─────────────────────────────────────────────────────────────────────────
  // Node sizes come from renderers when available
  const getNodeSize = (nid: string) => {
    const r = renderers.get(nid);
    if (r) {
      const m = r.measure();
      return { w: m.width, h: m.height };
    }
    return { w: 120, h: 40 };
  };

  const es = elkSpacing(theme);

  const elkInput = {
    id: '__sw_root',
    layoutOptions: {
      'elk.algorithm':         'box',
      'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
      'elk.spacing.nodeNode':  es.componentComponent,
    },
    children: allSubGroups.map(grp => ({
      id: grp.id,
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
        'portConstraints':                                  'FIXED_SIDE',
        // Padding inside each sub-group: top/bottom margin keeps nodes away
        // from the sub-group boundary (also accounts for the lane title bar
        // when yStart is offset by sizeS in the overlap enforcement below).
        'elk.padding':                                      `[top=${String(theme.nodeGap)},left=0,bottom=${String(theme.nodeGap)},right=0]`,
      },
      ports: grp.bPorts.map(p => ({
        id: p.id,
        layoutOptions: { 'port.side': p.side },
      })),
      children: grp.nodes.map(nid => {
        const sz = getNodeSize(nid);
        return { id: nid, width: sz.w, height: sz.h };
      }),
      edges: [
        ...grp.intraEdges.map(e => {
          const base = elkEdgeById.get(e.id);
          // Use ELK-preprocessed labels (with measured width/height/placement).
          // Strip layoutOptions (edgeLabels.inline) to avoid an ELK scanline-constraint
          // bug triggered by inline labels in ORTHOGONAL routing.
          return { id: e.id, sources: [e.from], targets: [e.to], labels: base?.labels };
        }),
        ...grp.bEdges.map(e => ({ id: e.id, sources: [e.src], targets: [e.tgt] })),
      ],
    })),
    edges: [],
  };

  const elkResult = await getElk().layout(elkInput);

  // Parse ELK results per sub-group
  for (const gc of (elkResult.children || []) as any[]) {
    const grp     = allSubGroups.find(g => g.id === gc.id);
    if (!grp) continue;
    grp.elkW    = gc.width  ?? 0;
    grp.elkH    = gc.height ?? 0;
    grp.nodePos = new Map((gc.children || []).map((n: any) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    grp.portPos = new Map((gc.ports    || []).map((p: any) => [p.id, { x: p.x ?? 0, y: p.y ?? 0 }]));
    for (const e of gc.edges || []) {
      grp.edgeSecs.set(e.id, e.sections || []);
      // Extract ELK-computed label positions
      const lblInfo: { labelPos?: { x: number; y: number }; labelSize?: { width: number; height: number } } = {};
      if (e.labels && e.labels.length > 0) {
        for (const lbl of e.labels) {
          if (lbl.x !== undefined && lbl.y !== undefined && lbl.placement !== 'tail' && lbl.placement !== 'head') {
            // Label coords are subgroup-local; Step 6 adds (g.globalX, g.yStart) to get global position
            lblInfo.labelPos  = { x: lbl.x + (lbl.width ?? 0) / 2, y: lbl.y + (lbl.height ?? 0) / 2 };
            lblInfo.labelSize = { width: Math.ceil(lbl.width ?? 0), height: Math.ceil(lbl.height ?? 0) };
          }
        }
      }
      grp.edgeLabels.set(e.id, lblInfo);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 4: Compute yStart per sub-group via port alignment + topo sort
  // ─────────────────────────────────────────────────────────────────────────
  const grpById  = new Map(allSubGroups.map(g => [g.id, g]));
  const grpAdj   = new Map(allSubGroups.map(g => [g.id, new Set<string>()]));
  const inDegree = new Map(allSubGroups.map(g => [g.id, 0]));

  // Cycle detection helper
  const hasCycle = (from: string, to: string): boolean => {
    const visited = new Set<string>();
    const stack   = [to];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === from) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const nb of Array.from(grpAdj.get(cur) || [])) stack.push(nb);
    }
    return false;
  };

  for (const ce of crossEdges) {
    const info = cePortMap.get(ce.id);
    if (!info) continue;
    const { srcGrp, tgtGrp } = info;
    if (srcGrp === tgtGrp) continue;
    if (hasCycle(srcGrp.id, tgtGrp.id)) continue;
    if (!grpAdj.get(srcGrp.id)!.has(tgtGrp.id)) {
      grpAdj.get(srcGrp.id)!.add(tgtGrp.id);
      inDegree.set(tgtGrp.id, (inDegree.get(tgtGrp.id) ?? 0) + 1);
    }
  }

  // Kahn's topo sort
  const topoQueue = allSubGroups.filter(g => (inDegree.get(g.id) ?? 0) === 0).map(g => g.id);
  const topoOrder: string[] = [];
  while (topoQueue.length) {
    const gid = topoQueue.shift()!;
    topoOrder.push(gid);
    for (const nid of Array.from(grpAdj.get(gid) || [])) {
      const d = (inDegree.get(nid) ?? 0) - 1;
      inDegree.set(nid, d);
      if (d === 0) topoQueue.push(nid);
    }
  }

  for (const g of allSubGroups) g.yStart = 0;

  // Apply alignment constraints in topo order
  for (const gid of topoOrder) {
    const srcGrp = grpById.get(gid)!;
    for (const ce of crossEdges) {
      const info = cePortMap.get(ce.id);
      if (!info || info.srcGrp !== srcGrp) continue;
      if (!grpAdj.get(srcGrp.id)!.has(info.tgtGrp.id)) continue; // back edge
      const exitY  = srcGrp.portPos.get(info.exitPortId)?.y  ?? 0;
      const entryY = info.tgtGrp.portPos.get(info.entryPortId)?.y ?? 0;
      const needed = srcGrp.yStart + exitY - entryY;
      if (needed > info.tgtGrp.yStart) info.tgtGrp.yStart = needed;
    }
  }

  // Enforce no vertical overlap within same lane (by lane index order).
  for (let li = 0; li < numLanes; li++) {
    const grpsInLane = allSubGroups.filter(g => g.laneIdx === li);
    let cursor = 0;
    for (const g of grpsInLane) {
      if (g.yStart < cursor) g.yStart = cursor;
      cursor = g.yStart + g.elkH + GRP_GAP;
    }
  }

  // Global vertical offset: shift all sub-groups down by the lane title-bar height
  // so nodes don't overlap the title. Applied after all yStart values are finalised
  // (including cross-group alignment) so edge routing is not distorted.
  const titleBarOffset = theme.titleBarH;
  for (const g of allSubGroups) g.yStart += titleBarOffset;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Lane x positions
  // ─────────────────────────────────────────────────────────────────────────
  const laneWidths: number[] = [];
  for (let li = 0; li < numLanes; li++) {
    const grpsInLane = allSubGroups.filter(g => g.laneIdx === li);
    const maxW = grpsInLane.length ? Math.max(...grpsInLane.map(g => g.elkW)) : 120;
    laneWidths.push(maxW + 2 * LANE_PAD);
  }

  const laneXStart: number[] = [0];
  for (let i = 1; i < numLanes; i++)
    laneXStart.push(laneXStart[i - 1] + laneWidths[i - 1] + LANE_GAP);

  for (const g of allSubGroups)
    g.globalX = laneXStart[g.laneIdx] + LANE_PAD;

  // ─────────────────────────────────────────────────────────────────────────
  // Step 6: Build LayoutResult
  // ─────────────────────────────────────────────────────────────────────────

  // --- Nodes ---
  const nodes: Record<string, LayoutNode> = {};
  for (const g of allSubGroups) {
    for (const nid of g.nodes) {
      const lp = g.nodePos.get(nid) ?? { x: 0, y: 0 };
      const sz = getNodeSize(nid);
      nodes[nid] = {
        id:     nid,
        x:      g.globalX + lp.x,
        y:      g.yStart  + lp.y,
        width:  sz.w,
        height: sz.h,
      };
    }
  }

  // --- Edges ---
  // Helper: flatten ELK sections to point array (global coords)
  const sectionsToPoints = (sections: any[], gx: number, gy: number) => {
    const pts: Array<{ x: number; y: number }> = [];
    for (const s of sections) {
      const raw = [s.startPoint, ...(s.bendPoints || []), s.endPoint].filter(Boolean);
      for (let i = 0; i < raw.length; i++) {
        // Skip duplicate start points across sections
        if (i === 0 && pts.length > 0) continue;
        pts.push({ x: gx + raw[i].x, y: gy + raw[i].y });
      }
    }
    return pts;
  };

  const layoutEdges: LayoutEdge[] = [];

  // Intra-lane edges (from ELK sections, translated to global coords)
  for (const g of allSubGroups) {
    const dy = g.yStart;   // ELK gave local coords; global offset is (g.globalX, g.yStart)
    const dx = g.globalX;
    for (const e of g.intraEdges) {
      const sections = g.edgeSecs.get(e.id) ?? [];
      const points   = sectionsToPoints(sections, dx, dy);
      const lbl      = g.edgeLabels.get(e.id);
      // label position is in ELK's container-local coords (gc.x=0, gc.y=0 since box root)
      // translate to global by adding (g.globalX, g.yStart)
      const labelPos  = lbl?.labelPos  ? { x: lbl.labelPos.x + dx, y: lbl.labelPos.y + dy } : undefined;
      const labelSize = lbl?.labelSize;
      layoutEdges.push({ id: e.id, from: e.from, to: e.to, points: points.length >= 2 ? points : undefined, labelPos, labelSize });
    }
  }

  // Cross-lane edges: boundary-edge-in + horizontal gap + boundary-edge-out
  for (const ce of crossEdges) {
    const info = cePortMap.get(ce.id);
    if (!info) continue;
    const { exitPortId, entryPortId, srcGrp, tgtGrp } = info;

    // ELK sections for the two internal boundary edges
    const outSections = srcGrp.edgeSecs.get(`__ce_out_${ce.id}`) ?? [];
    const inSections  = tgtGrp.edgeSecs.get(`__ce_in_${ce.id}`)  ?? [];
    const outPts      = sectionsToPoints(outSections, srcGrp.globalX, srcGrp.yStart);
    const inPts       = sectionsToPoints(inSections,  tgtGrp.globalX, tgtGrp.yStart);

    // Gap connection: last point of outPts → first point of inPts
    const allPts: Array<{ x: number; y: number }> = [];
    if (outPts.length >= 2) allPts.push(...outPts);
    if (inPts.length  >= 2) allPts.push(...inPts);

    layoutEdges.push({ id: ce.id, from: ce.from, to: ce.to, points: allPts.length >= 2 ? allPts : undefined });
  }

  // --- Lane container groups ---
  const totalH = Math.max(...allSubGroups.map(g => g.yStart + g.elkH), 100) + theme.nodeGap;
  const groups: Record<string, LayoutGroup> = {};

  // Swimlane container
  const totalW = laneXStart[numLanes - 1] + laneWidths[numLanes - 1];
  groups[swimContainer.id] = { id: swimContainer.id, x: 0, y: 0, width: totalW, height: totalH };

  // Each lane (concurrent region)
  for (let li = 0; li < numLanes; li++) {
    const rid = `${swimContainer.id}.__conc_region__${li}`;
    groups[rid] = {
      id:     rid,
      x:      laneXStart[li],
      y:      0,
      width:  laneWidths[li],
      height: totalH,
    };
  }

  const layout: LayoutResult = { nodes, edges: layoutEdges, groups };
  return { layout, renderers };
}




