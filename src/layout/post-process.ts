/**
 * Layout post-processing — engine-agnostic adjustments applied after
 * any layout engine (DOT, ELK, …) produces raw coordinates.
 *
 * Extracted from dot-layout.ts so both DOT and future ELK pipelines
 * share the same post-processing logic.
 */

import type { LayoutResult, LayoutNode, LayoutGroup, LayoutEdge } from '../model/index.ts';
import type { SemanticModel } from '../model/index.ts';
import { createTheme, type Theme } from '../shared/theme.ts';
import { Renderer } from '../primitives/renderer.ts';

// ---------------------------------------------------------------------------
// Geometry helpers (shared by extractLayout and snapPortNodes)
// ---------------------------------------------------------------------------

/** Check if a point is inside (or on the boundary of) a group's bounding box */
export function isInsideGroup(px: number, py: number, g: LayoutGroup): boolean {
  return px >= g.x && px <= g.x + g.width && py >= g.y && py <= g.y + g.height;
}

/**
 * Find the intersection point of a line segment with a rectangle boundary.
 * Returns the crossing point closest to p1, or null if no intersection.
 */
export function segmentRectIntersection(
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
  const t1 = segIntersectVertical(p1, p2, left, top, bottom);
  if (t1 != null) candidates.push({ x: left, y: p1.y + t1 * (p2.y - p1.y), t: t1 });
  const t2 = segIntersectVertical(p1, p2, right, top, bottom);
  if (t2 != null) candidates.push({ x: right, y: p1.y + t2 * (p2.y - p1.y), t: t2 });
  const t3 = segIntersectHorizontal(p1, p2, top, left, right);
  if (t3 != null) candidates.push({ x: p1.x + t3 * (p2.x - p1.x), y: top, t: t3 });
  const t4 = segIntersectHorizontal(p1, p2, bottom, left, right);
  if (t4 != null) candidates.push({ x: p1.x + t4 * (p2.x - p1.x), y: bottom, t: t4 });

  if (candidates.length === 0) return null;
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
  return { x: candidates[0].x, y: candidates[0].y };
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * Clip a path at the group boundary.
 *
 * - mode 'start': path starts inside the group → clip internal prefix.
 * - mode 'end': path ends inside the group → clip internal suffix.
 */
export function clipPathAtGroupBoundary(
  points: Array<{ x: number; y: number }>,
  g: LayoutGroup,
  mode: 'start' | 'end',
): Array<{ x: number; y: number }> {
  if (points.length < 2) return points;

  if (mode === 'start') {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const p1Inside = isInsideGroup(p1.x, p1.y, g);
      const p2Inside = isInsideGroup(p2.x, p2.y, g);

      if (p1Inside && !p2Inside) {
        const cross = segmentRectIntersection(p1, p2, g);
        if (cross) {
          return [{ x: cross.x, y: cross.y }, ...points.slice(i + 1)];
        }
      }
      if (!p1Inside) return points;
    }
    const snapped = snapToGroupBoundary(points[0], g);
    return [snapped, ...points.slice(1)];
  } else {
    for (let i = points.length - 1; i > 0; i--) {
      const p1 = points[i - 1];
      const p2 = points[i];
      const p1Inside = isInsideGroup(p1.x, p1.y, g);
      const p2Inside = isInsideGroup(p2.x, p2.y, g);

      if (!p1Inside && p2Inside) {
        const cross = segmentRectIntersection(p1, p2, g);
        if (cross) {
          return [...points.slice(0, i), { x: cross.x, y: cross.y }];
        }
      }
      if (!p2Inside) return points;
    }
    const snapped = snapToGroupBoundary(points[points.length - 1], g);
    return [...points.slice(0, -1), snapped];
  }
}

// ---------------------------------------------------------------------------
// Edge-edge spacing enforcement
// ---------------------------------------------------------------------------

/**
 * A "trunk" is a maximal run of consecutive points in an edge that share
 * the same x (vertical) or y (horizontal) coordinate.  Moving an entire
 * trunk preserves edge continuity — adjacent segments simply stretch or
 * shrink because the shared endpoint moves with the trunk.
 */
interface EdgeTrunk {
  edgeIdx: number;
  /** First point index in the trunk (inclusive) */
  startPtIdx: number;
  /** Last point index in the trunk (inclusive) */
  endPtIdx: number;
  /** Shared coordinate (x for vertical, y for horizontal) */
  pos: number;
  /** Range extent (y-min/max for vertical, x-min/max for horizontal) */
  rangeMin: number;
  rangeMax: number;
}

/**
 * Post-process edge routes to enforce minimum edge-edge spacing.
 *
 * ELK does not guarantee edge-edge spacing for cross-hierarchy edges
 * (edges routed through different hierarchy levels). This function
 * detects overlapping parallel edge trunks and fans them apart.
 *
 * Unlike a per-segment approach, this moves ALL consecutive points at
 * the same coordinate together, so edge polylines stay connected.
 */
export function separateOverlappingEdges(layout: LayoutResult, minGap: number): void {
  if (minGap <= 0) return;
  const edges = layout.edges;
  if (!edges || edges.length < 2) return;

  _separateTrunks(edges, minGap, true);   // vertical trunks
  _separateTrunks(edges, minGap, false);  // horizontal trunks
}

/**
 * Build trunks, group overlapping ones via union-find, and fan each group apart.
 */
function _separateTrunks(
  edges: LayoutEdge[],
  minGap: number,
  vertical: boolean,
): void {
  // 1. Build trunks — maximal runs of consecutive points at the same coord
  const trunks: EdgeTrunk[] = [];
  for (let ei = 0; ei < edges.length; ei++) {
    const pts = edges[ei].points;
    if (!pts || pts.length < 2) continue;
    let i = 0;
    while (i < pts.length) {
      const coord = vertical ? pts[i].x : pts[i].y;
      let j = i + 1;
      while (j < pts.length && Math.abs((vertical ? pts[j].x : pts[j].y) - coord) < 0.5) {
        j++;
      }
      if (j - i >= 2) {
        let rMin = Infinity, rMax = -Infinity;
        for (let k = i; k < j; k++) {
          const v = vertical ? pts[k].y : pts[k].x;
          if (v < rMin) rMin = v;
          if (v > rMax) rMax = v;
        }
        if (rMax - rMin > 0.5) {
          trunks.push({ edgeIdx: ei, startPtIdx: i, endPtIdx: j - 1, pos: coord, rangeMin: rMin, rangeMax: rMax });
        }
      }
      i = j;
    }
  }
  if (trunks.length < 2) return;

  // 2. Union-find grouping: trunks from different edges that are within
  //    minGap and overlap in range belong to the same conflict group.
  const parent = trunks.map((_, idx) => idx);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  const unite = (a: number, b: number): void => { parent[find(a)] = find(b); };

  const byPos = trunks.map((t, idx) => ({ idx, pos: t.pos }));
  byPos.sort((a, b) => a.pos - b.pos);

  for (let i = 0; i < byPos.length; i++) {
    for (let j = i + 1; j < byPos.length; j++) {
      if (byPos[j].pos - byPos[i].pos >= minGap) break;
      const ti = trunks[byPos[i].idx], tj = trunks[byPos[j].idx];
      if (ti.edgeIdx === tj.edgeIdx) continue;
      // Range overlap?
      if (Math.min(ti.rangeMax, tj.rangeMax) > Math.max(ti.rangeMin, tj.rangeMin)) {
        unite(byPos[i].idx, byPos[j].idx);
      }
    }
  }

  // Collect groups with 2+ members
  const groups = new Map<number, number[]>();
  for (let i = 0; i < trunks.length; i++) {
    const root = find(i);
    let arr = groups.get(root);
    if (!arr) { arr = []; groups.set(root, arr); }
    arr.push(i);
  }

  // 3. For each conflict group, fan trunks apart.
  //    Longest trunk stays at anchor position; others fan out to the right.
  for (const memberIdxs of Array.from(groups.values())) {
    if (memberIdxs.length < 2) continue;
    const members = memberIdxs.map(i => trunks[i]);
    // Sort by range extent descending — longest trunk stays in place
    members.sort((a, b) => (b.rangeMax - b.rangeMin) - (a.rangeMax - a.rangeMin));
    const anchorPos = members[0].pos;
    for (let k = 1; k < members.length; k++) {
      const pts = edges[members[k].edgeIdx].points!;
      // Skip the first segment (exit from source) and the last segment
      // (entry to target): ELK has already placed these perimeter points
      // correctly; moving them shifts the connection away from the intended face.
      if (members[k].startPtIdx === 0 || members[k].endPtIdx === pts.length - 1) continue;
      const newPos = anchorPos + k * minGap;
      const delta = newPos - members[k].pos;
      if (Math.abs(delta) < 0.01) continue;
      for (let pi = members[k].startPtIdx; pi <= members[k].endPtIdx; pi++) {
        if (vertical) {
          pts[pi].x += delta;
        } else {
          pts[pi].y += delta;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Port node snapping
// ---------------------------------------------------------------------------

/**
 * Snap port nodes to their parent group boundary after layout,
 * then clip edge waypoints for edges that cross the port from outside the group.
 */
export function snapPortNodes(
  layout: LayoutResult,
  model: SemanticModel,
  renderers: Map<string, Renderer>,
  theme: Theme = createTheme(),
  elkPortIds?: Set<string>,
): void {
  const PORT_SIZE = theme.portSize;
  const PORT_HALF = PORT_SIZE / 2;
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

      // ELK port nodes already have correct positions from the layout engine.
      // Only clip internal edge paths to the port box; skip position reset.
      if (elkPortIds?.has(childId)) {
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
              edge.points = clipPathAtGroupBoundary(edge.points, portBox, 'end');
            }
          } else if (edge.from === childId) {
            const otherGroupId = nodeGroupMap.get(edge.to);
            if (otherGroupId === group.id) {
              edge.points = clipPathAtGroupBoundary(edge.points, portBox, 'start');
            }
          }
        }
        continue;
      }

      // --- Pass 1: External edges ---
      let intersectionSet = false;
      for (const edge of layout.edges || []) {
        if (!edge.points || edge.points.length < 2) continue;

        if (edge.to === childId) {
          const otherGroupId = nodeGroupMap.get(edge.from);
          if (otherGroupId !== group.id) {
            const pts = edge.points;
            // Scan all segments backwards to find the boundary crossing point.
            // The last segment alone may be entirely inside the group for curved edges.
            let cross: { x: number; y: number } | null = null;
            for (let i = pts.length - 1; i > 0; i--) {
              const segA = pts[i - 1];
              const segB = pts[i];
              if (!isInsideGroup(segA.x, segA.y, groupBox)) {
                cross = segmentRectIntersection(segA, segB, groupBox);
                break;
              }
            }
            if (!cross) cross = pts[pts.length - 1]; // fallback
            if (!intersectionSet) {
              portNode.x = cross.x - PORT_HALF;
              portNode.y = cross.y - PORT_HALF;
              portNode.width = PORT_SIZE;
              portNode.height = PORT_SIZE;
              intersectionSet = true;
            }
            edge.points = clipPathAtGroupBoundary(pts, groupBox, 'end');
          }
        } else if (edge.from === childId) {
          const otherGroupId = nodeGroupMap.get(edge.to);
          if (otherGroupId !== group.id) {
            const pts = edge.points;
            // Scan all segments forward to find the boundary crossing point.
            let cross: { x: number; y: number } | null = null;
            for (let i = 0; i < pts.length - 1; i++) {
              const segA = pts[i];
              const segB = pts[i + 1];
              if (!isInsideGroup(segB.x, segB.y, groupBox)) {
                cross = segmentRectIntersection(segA, segB, groupBox);
                break;
              }
            }
            if (!cross) cross = pts[0]; // fallback
            if (!intersectionSet) {
              portNode.x = cross.x - PORT_HALF;
              portNode.y = cross.y - PORT_HALF;
              portNode.width = PORT_SIZE;
              portNode.height = PORT_SIZE;
              intersectionSet = true;
            }
            edge.points = clipPathAtGroupBoundary(pts, groupBox, 'start');
          }
        }
      }

      // Fallback: snap to group boundary by portKind
      if (!intersectionSet) {
        if (r.portKind === 'portout') {
          portNode.y = groupBox.y + groupBox.height - PORT_HALF;
        } else {
          portNode.y = groupBox.y - PORT_HALF;
        }
      }

      // --- Pass 2: Internal edges ---
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
            edge.points = clipPathAtGroupBoundary(edge.points, portBox, 'end');
          }
        } else if (edge.from === childId) {
          const otherGroupId = nodeGroupMap.get(edge.to);
          if (otherGroupId === group.id) {
            edge.points = clipPathAtGroupBoundary(edge.points, portBox, 'start');
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Title positioning
// ---------------------------------------------------------------------------

/**
 * Place the __title__ renderer above the diagram using negative Y.
 * DrawIO supports negative coordinates, so no DOT node is needed.
 */
export function positionTitle(layout: LayoutResult, renderers: Map<string, Renderer>): void {
  const titleR = renderers.get('__title__');
  if (!titleR) return;

  const sz = titleR.measure();
  const nodeValues = Object.values(layout.nodes);
  const groupValues: LayoutNode[] = layout.groups ? Object.values(layout.groups) : [];
  const allBoxes = [...nodeValues, ...groupValues];
  if (allBoxes.length === 0) return;

  const minX = Math.min(...allBoxes.map(n => n.x));
  const maxX = Math.max(...allBoxes.map(n => n.x + n.width));
  const minY = Math.min(...allBoxes.map(n => n.y));

  const diagramWidth = maxX - minX;
  const titleX = minX + (diagramWidth - sz.width) / 2;
  const titleY = minY - sz.height;

  layout.nodes['__title__'] = {
    id: '__title__',
    x: titleX,
    y: titleY,
    width: sz.width,
    height: sz.height,
  };
}

// ---------------------------------------------------------------------------
// Swimlane region normalization (used by both ELK and DOT engines)
// ---------------------------------------------------------------------------

/**
 * Normalize swimlane region heights so all lanes span the full container.
 *
 * For DOT engine: nodes are already in correct columns (DOT clusters).
 *   Only normalizes region heights to span full container.
 */
export function rearrangeSwimlanes(layout: LayoutResult, model: SemanticModel, theme: Theme = createTheme()): void {
  if (!model.groups) return;

  for (const group of model.groups) {
    if (group.type !== 'swimlane_container' || !group.concurrentRegions || group.concurrentRegions.length < 2) continue;

    const containerPos = layout.groups?.[group.id];
    if (!containerPos) continue;

    if (model.rankdir === 'LR') {
      _rearrangeSwimlaneDotLR(layout, group, containerPos, theme);
    } else {
      _rearrangeSwimlaneDot(layout, group, containerPos);
    }
  }
}

/**
 * DOT mode: normalize region and container bounds.
 *
 * Two-pass spine layout already enforces correct column ordering and
 * edge routing. This function only unifies Y/height so all regions
 * share the same vertical extent.
 */
function _rearrangeSwimlaneDot(
  layout: LayoutResult,
  group: { id: string; concurrentRegions: string[][]; children: string[] },
  containerPos: LayoutGroup,
): void {
  const regions = group.concurrentRegions;
  const numLanes = regions.length;

  // Collect region positions from layout engine
  const regionIds: string[] = [];
  for (let i = 0; i < numLanes; i++) {
    regionIds.push(`${group.id}.__conc_region__${i}`);
  }

  // Compute unified bounds from all regions and nodes
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const rid of regionIds) {
    const pos = layout.groups?.[rid];
    if (!pos) continue;
    minX = Math.min(minX, pos.x);
    maxX = Math.max(maxX, pos.x + pos.width);
    minY = Math.min(minY, pos.y);
    maxY = Math.max(maxY, pos.y + pos.height);
  }

  for (const nid of group.children) {
    const n = layout.nodes[nid];
    if (!n) continue;
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + n.height);
  }

  if (minX === Infinity) return;

  const totalHeight = maxY - minY;

  // Update container bounds
  containerPos.x = minX;
  containerPos.y = minY;
  containerPos.width = maxX - minX;
  containerPos.height = totalHeight;

  // Normalize each region: keep X/width from DOT, unify Y/height
  if (!layout.groups) layout.groups = {};
  for (const rid of regionIds) {
    const existing = layout.groups[rid];
    if (existing) {
      existing.y = minY;
      existing.height = totalHeight;
    }
  }
}

/**
 * DOT LR mode: lanes are stacked vertically (horizontal bands).
 * Each lane spans the full container width; heights are normalized.
 * A LANE_HEADER offset is added on the left for the lane title area.
 */
function _rearrangeSwimlaneDotLR(
  layout: LayoutResult,
  group: { id: string; concurrentRegions: string[][]; children: string[] },
  containerPos: LayoutGroup,
  theme: Theme = createTheme(),
): void {
  const regions = group.concurrentRegions;
  const numLanes = regions.length;
  const LANE_PAD = theme.groupPad;
  const LANE_HEADER = theme.rowH; // left-side title width for horizontal lanes

  // Build node→lane index map
  const nodeLane = new Map<string, number>();
  for (let i = 0; i < numLanes; i++) {
    for (const nid of regions[i]) {
      nodeLane.set(nid, i);
    }
  }

  // Compute height of each lane: max node height + 2*padding
  const laneHeights: number[] = [];
  for (let i = 0; i < numLanes; i++) {
    let maxH = 0;
    for (const nid of regions[i]) {
      const n = layout.nodes[nid];
      if (n) maxH = Math.max(maxH, n.height);
    }
    const minLaneH = theme.nodeGap * 2; // 80 at base 12
    laneHeights.push(Math.max(maxH + 2 * LANE_PAD, minLaneH));
  }

  // Compute lane Y offsets (cumulative)
  const laneY: number[] = [];
  let accY = 0;
  for (let i = 0; i < numLanes; i++) {
    laneY.push(accY);
    accY += laneHeights[i];
  }
  const totalHeight = accY;

  // Compute X bounds from all regions and nodes
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < numLanes; i++) {
    const regionId = `${group.id}.__conc_region__${i}`;
    const pos = layout.groups?.[regionId];
    if (pos) {
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x + pos.width);
    }
  }
  for (const nid of group.children) {
    const n = layout.nodes[nid];
    if (!n) continue;
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.width);
  }
  if (!isFinite(minX)) return;

  const totalWidth = maxX - minX + LANE_HEADER;
  const containerY = containerPos.y;
  const containerX = minX;

  // Move each node: shift right by LANE_HEADER, center vertically in lane
  for (const nid of group.children) {
    const n = layout.nodes[nid];
    if (!n) continue;
    const lane = nodeLane.get(nid);
    if (lane === undefined) continue;

    n.x = n.x + LANE_HEADER;
    n.y = containerY + laneY[lane] + (laneHeights[lane] - n.height) / 2;
  }

  // Update container
  containerPos.x = containerX;
  containerPos.y = containerY;
  containerPos.width = totalWidth;
  containerPos.height = totalHeight;

  // Update region groups — horizontal bands
  if (!layout.groups) layout.groups = {};
  for (let i = 0; i < numLanes; i++) {
    const regionId = `${group.id}.__conc_region__${i}`;
    layout.groups[regionId] = {
      id: regionId,
      x: containerX,
      y: containerY + laneY[i],
      width: containerPos.width,
      height: laneHeights[i],
    };
  }
}

// ---------------------------------------------------------------------------
// Fix ortho edges for swimlane diagrams
// ---------------------------------------------------------------------------

/**
 * Post-process ortho edges so that:
 *   1. Edges always exit from the bottom of the source node and enter
 *      from the top of the target node (no side connections).
 *   2. Multiple outgoing/incoming edges are evenly distributed across
 *      the node width using (n+1) equal segments.
 *   3. Cross-column edges get a 4-point ortho path (↓ → ↓).
 *   4. Straight vertical edges remain 2-point.
 *
 * Coordinate system: DrawIO (Y increases downward).
 *   node bottom = y + height, node top = y.
 */

// ---------------------------------------------------------------------------
// fixNodeSpacing — enforce minimum vertical gap between nodes in each lane
// ---------------------------------------------------------------------------

/**
 * After DOT ortho layout + swimlane rearrangement, some nodes within the
 * same lane may end up vertically too close.  This pass scans each lane
 * for violations of `minGap` and pushes ALL nodes (across all lanes)
 * below the offending threshold downward by the required delta.  Group
 * geometries are adjusted accordingly.
 *
 * Must be called BEFORE fixOrthoEdges (which rebuilds edge paths from
 * corrected node positions).
 */
export function fixNodeSpacing(layout: LayoutResult, model: SemanticModel, theme: Theme = createTheme()): void {
  if (!model.groups) return;

  const minGap = theme.nodeGap;

  const swimContainer = model.groups.find(
    g => g.type === 'swimlane_container' && g.concurrentRegions && g.concurrentRegions.length > 1
  );
  if (!swimContainer || !swimContainer.concurrentRegions) return;

  const nodes = layout.nodes;
  const regions = swimContainer.concurrentRegions;
  const edges = model.edges || [];
  const isLR = model.rankdir === 'LR';

  // Build a set of connected node-pair keys for quick lookup
  const connectedPairs = new Set<string>();
  for (const e of edges) {
    connectedPairs.add(e.from + '\0' + e.to);
    connectedPairs.add(e.to + '\0' + e.from);
  }

  // Iterate until no violations remain (a push in one lane may reveal
  // a new violation in another lane after its nodes shift).
  let changed = true;
  while (changed) {
    changed = false;

    for (const region of regions) {
      // Collect nodes in this lane, sorted along the flow axis
      const laneNodes = region
        .map(nid => nodes[nid])
        .filter((n): n is LayoutNode => n != null)
        .sort((a, b) => isLR ? a.x - b.x : a.y - b.y);

      for (let i = 0; i < laneNodes.length - 1; i++) {
        const prev = laneNodes[i];
        const next = laneNodes[i + 1];

        // If the next node has INCOMING edges from nodes other than the
        // previous node (e.g. cross-lane edges), double the required gap
        // to leave room for the incoming edge routing.
        const nextHasExternalIncoming = edges.some(e =>
          e.to === next.id && e.from !== prev.id
        );
        const requiredGap = nextHasExternalIncoming ? minGap * 2 : minGap;

        // LR: check horizontal gap; TB: check vertical gap
        const gap = isLR
          ? next.x - (prev.x + prev.width)
          : next.y - (prev.y + prev.height);

        // Use 0.5px tolerance to avoid infinite loop from floating-point rounding
        if (gap < requiredGap - 0.5) {
          const delta = requiredGap - gap;

          if (isLR) {
            const threshold = next.x;
            // Push ALL nodes at or beyond threshold to the right
            // (exclude prev to avoid pushing both when prev.x == next.x)
            Object.keys(nodes).forEach(nid => {
              if (nid !== prev.id && nodes[nid].x >= threshold) {
                nodes[nid].x += delta;
              }
            });
            // Adjust groups
            if (layout.groups) {
              Object.keys(layout.groups).forEach(gid => {
                const g = layout.groups![gid];
                if (g.x >= threshold) {
                  g.x += delta;
                } else if (g.x + g.width > threshold) {
                  g.width += delta;
                }
              });
            }
          } else {
            const threshold = next.y;
            // Push ALL nodes at or below threshold down
            // (exclude prev to avoid pushing both when prev.y == next.y)
            Object.keys(nodes).forEach(nid => {
              if (nid !== prev.id && nodes[nid].y >= threshold) {
                nodes[nid].y += delta;
              }
            });
            // Adjust groups: push down if entirely below, expand if straddling
            if (layout.groups) {
              Object.keys(layout.groups).forEach(gid => {
                const g = layout.groups![gid];
                if (g.y >= threshold) {
                  g.y += delta;
                } else if (g.y + g.height > threshold) {
                  g.height += delta;
                }
              });
            }
          }

          changed = true;
        }
      }
    }
  }
}

export function fixOrthoEdges(layout: LayoutResult, model: SemanticModel): void {
  const edges = layout.edges;
  if (!edges || edges.length === 0) return;

  const nodes = layout.nodes;
  const isLR = model.rankdir === 'LR';

  // Collect incoming / outgoing edge indices per node
  const inMap = new Map<string, number[]>();
  const outMap = new Map<string, number[]>();
  edges.forEach((e, i) => {
    if (!inMap.has(e.to)) inMap.set(e.to, []);
    inMap.get(e.to)!.push(i);
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from)!.push(i);
  });

  if (isLR) {
    // --- LR mode: exit from right side, entry from left side ---

    // Assign exit positions (right side of source node)
    outMap.forEach((indices, nodeId) => {
      const node = nodes[nodeId];
      if (!node) return;
      // sort outgoing edges by target node Y (top → bottom)
      indices.sort((a, b) => {
        const na = nodes[edges[a].to];
        const nb = nodes[edges[b].to];
        return ((na?.y ?? 0) + (na?.height ?? 0) / 2) - ((nb?.y ?? 0) + (nb?.height ?? 0) / 2);
      });
      const count = indices.length;
      const exitX = node.x + node.width; // right edge
      const top = node.y;
      indices.forEach((ei, idx) => {
        const exitY = top + node.height * (idx + 1) / (count + 1);
        (edges[ei] as any)._exitX = exitX;
        (edges[ei] as any)._exitY = exitY;
      });
    });

    // Assign entry positions (left side of target node)
    inMap.forEach((indices, nodeId) => {
      const node = nodes[nodeId];
      if (!node) return;
      // sort incoming edges by source node Y (top → bottom)
      indices.sort((a, b) => {
        const na = nodes[edges[a].from];
        const nb = nodes[edges[b].from];
        return ((na?.y ?? 0) + (na?.height ?? 0) / 2) - ((nb?.y ?? 0) + (nb?.height ?? 0) / 2);
      });
      const count = indices.length;
      const entryX = node.x; // left edge
      const top = node.y;
      indices.forEach((ei, idx) => {
        const entryY = top + node.height * (idx + 1) / (count + 1);
        (edges[ei] as any)._entryX = entryX;
        (edges[ei] as any)._entryY = entryY;
      });
    });
  } else {
    // --- TB mode: exit from bottom, entry from top ---

    // Assign exit X positions (bottom of source node)
    outMap.forEach((indices, nodeId) => {
      const node = nodes[nodeId];
      if (!node) return;
      // sort outgoing edges by target node X (left → right)
      indices.sort((a, b) => {
        const na = nodes[edges[a].to];
        const nb = nodes[edges[b].to];
        return ((na?.x ?? 0) + (na?.width ?? 0) / 2) - ((nb?.x ?? 0) + (nb?.width ?? 0) / 2);
      });
      const count = indices.length;
      const exitY = node.y + node.height; // bottom edge
      const left = node.x;
      indices.forEach((ei, idx) => {
        const exitX = left + node.width * (idx + 1) / (count + 1);
        (edges[ei] as any)._exitX = exitX;
        (edges[ei] as any)._exitY = exitY;
      });
    });

    // Assign entry X positions (top of target node)
    inMap.forEach((indices, nodeId) => {
      const node = nodes[nodeId];
      if (!node) return;
      // sort incoming edges by source node X (left → right)
      indices.sort((a, b) => {
        const na = nodes[edges[a].from];
        const nb = nodes[edges[b].from];
        return ((na?.x ?? 0) + (na?.width ?? 0) / 2) - ((nb?.x ?? 0) + (nb?.width ?? 0) / 2);
      });
      const count = indices.length;
      const entryY = node.y; // top edge
      const left = node.x;
      indices.forEach((ei, idx) => {
        const entryX = left + node.width * (idx + 1) / (count + 1);
        (edges[ei] as any)._entryX = entryX;
        (edges[ei] as any)._entryY = entryY;
      });
    });
  }

  // --- rebuild ortho paths ---
  for (const e of edges) {
    const ex = (e as any)._exitX as number | undefined;
    const ey = (e as any)._exitY as number | undefined;
    const nx = (e as any)._entryX as number | undefined;
    const ny = (e as any)._entryY as number | undefined;
    if (ex == null || ey == null || nx == null || ny == null) continue;

    if (isLR) {
      // LR mode: flow is left→right
      const midX = (ex + nx) / 2;

      if (Math.abs(ey - ny) < 5) {
        // same row (within 5px tolerance) → straight horizontal line
        const avgY = (ey + ny) / 2;
        if (e.points && e.points.length === 2) {
          const d0 = Math.abs(e.points[0].y - avgY) + Math.abs(e.points[0].x - ex);
          const d1 = Math.abs(e.points[1].y - avgY) + Math.abs(e.points[1].x - nx);
          if (d0 < 5 && d1 < 5) {
            delete (e as any)._exitX; delete (e as any)._exitY;
            delete (e as any)._entryX; delete (e as any)._entryY;
            continue;
          }
        }
        e.points = [{ x: ex, y: avgY }, { x: nx, y: avgY }];
      } else {
        // cross-row → 4-point ortho (exit → → vertical → → entry)
        e.points = [
          { x: ex, y: ey },
          { x: midX, y: ey },
          { x: midX, y: ny },
          { x: nx, y: ny },
        ];
      }
    } else {
      // TB mode: flow is top→bottom
      const midY = (ey + ny) / 2;

      if (Math.abs(ex - nx) < 5) {
        // same column (within 5px tolerance) → straight vertical line
        const avgX = (ex + nx) / 2;
        if (e.points && e.points.length === 2) {
          const dx0 = Math.abs(e.points[0].x - avgX) + Math.abs(e.points[0].y - ey);
          const dx1 = Math.abs(e.points[1].x - avgX) + Math.abs(e.points[1].y - ny);
          if (dx0 < 5 && dx1 < 5) {
            delete (e as any)._exitX; delete (e as any)._exitY;
            delete (e as any)._entryX; delete (e as any)._entryY;
            continue;
          }
        }
        e.points = [{ x: avgX, y: ey }, { x: avgX, y: ny }];
      } else {
        // cross-column → 4-point ortho (exit ↓ → horizontal → ↓ entry)
        e.points = [
          { x: ex, y: ey },
          { x: ex, y: midY },
          { x: nx, y: midY },
          { x: nx, y: ny },
        ];
      }
    }

    // Recalculate label position to midpoint of the middle segment
    if (e.labelPos && e.points.length === 4) {
      e.labelPos = {
        x: (e.points[1].x + e.points[2].x) / 2,
        y: (e.points[1].y + e.points[2].y) / 2,
      };
    } else if (e.labelPos && e.points.length === 2) {
      e.labelPos = {
        x: (e.points[0].x + e.points[1].x) / 2,
        y: (e.points[0].y + e.points[1].y) / 2,
      };
    }

    // Clean up temp properties
    delete (e as any)._exitX;
    delete (e as any)._exitY;
    delete (e as any)._entryX;
    delete (e as any)._entryY;
  }
}

// ---------------------------------------------------------------------------
// avoidNodeCollisions — reroute ortho edges around non-target nodes
// ---------------------------------------------------------------------------

/**
 * After fixOrthoEdges, some edge segments may pass through nodes that are
 * neither the source nor the target.  This function detects such collisions
 * and reroutes the edge around the obstacle node's expanded bounding box.
 *
 * Algorithm:
 *   1. Detect collision of edge path with actual node rect.
 *   2. Find where the edge enters/exits the expanded (margin) rect.
 *   3. Build two detour paths around the expanded rect (CW and CCW).
 *   4. Pick the shorter one, splice it in, and remove bypassed points.
 */
export function avoidNodeCollisions(layout: LayoutResult, _model: SemanticModel, theme: Theme = createTheme()): void {
  const margin = theme.nodeGap / 3;
  const edges = layout.edges;
  if (!edges || edges.length === 0) return;
  const nodes = layout.nodes;
  const nodeIds = Object.keys(nodes);

  for (const edge of edges) {
    if (!edge.points || edge.points.length < 2) continue;

    const skipIds = new Set([edge.from, edge.to]);
    const obstacles = nodeIds.filter(id => !skipIds.has(id)).map(id => nodes[id]);
    if (obstacles.length === 0) continue;

    let modified = false;

    for (const obs of obstacles) {
      const pts = edge.points!;

      // Expanded rect = node rect + margin
      const expRect = {
        left: obs.x - margin, top: obs.y - margin,
        right: obs.x + obs.width + margin, bottom: obs.y + obs.height + margin,
      };

      // Check if any segment crosses the expanded rect (not just the node rect)
      let hasCollision = false;
      for (let i = 0; i < pts.length - 1; i++) {
        if (_segIntersectsRect(pts[i], pts[i + 1],
          expRect.left, expRect.top, expRect.right, expRect.bottom)) {
          hasCollision = true;
          break;
        }
      }
      if (!hasCollision) continue;

      let entryIdx = -1;
      let entryPt: { x: number; y: number } | null = null;
      let entrySide = '';
      let exitIdx = -1;
      let exitPt: { x: number; y: number } | null = null;
      let exitSide = '';

      for (let i = 0; i < pts.length - 1; i++) {
        const ints = _orthoSegRectIntersections(pts[i], pts[i + 1], expRect);
        for (const inter of ints) {
          if (entryIdx === -1) {
            entryIdx = i;
            entryPt = inter.point;
            entrySide = inter.side;
          }
          // Last intersection wins as exit
          exitIdx = i;
          exitPt = inter.point;
          exitSide = inter.side;
        }
      }

      if (!entryPt || !exitPt || entryIdx === -1) continue;

      // Build CW and CCW detour paths, pick shorter
      const cwCorners = _buildRectDetour(entrySide, exitSide, expRect, true);
      const ccwCorners = _buildRectDetour(entrySide, exitSide, expRect, false);
      const cwLen = _orthoPathLen([entryPt, ...cwCorners, exitPt]);
      const ccwLen = _orthoPathLen([entryPt, ...ccwCorners, exitPt]);
      const detour = cwLen <= ccwLen ? cwCorners : ccwCorners;

      // Rebuild edge: [0..entryIdx] + entryPt + detour + exitPt + [exitIdx+1..end]
      const newPts: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= entryIdx; i++) newPts.push(pts[i]);
      newPts.push({ x: entryPt.x, y: entryPt.y });
      for (const dp of detour) newPts.push({ x: dp.x, y: dp.y });
      newPts.push({ x: exitPt.x, y: exitPt.y });
      for (let i = exitIdx + 1; i < pts.length; i++) newPts.push(pts[i]);

      edge.points = newPts;
      modified = true;
    }

    // Recalculate label position after rerouting
    if (modified && edge.labelPos && edge.points.length >= 2) {
      let bestLen = 0;
      let bestIdx = 0;
      for (let i = 0; i < edge.points.length - 1; i++) {
        const dx = edge.points[i + 1].x - edge.points[i].x;
        const dy = edge.points[i + 1].y - edge.points[i].y;
        const len = Math.abs(dx) + Math.abs(dy);
        if (len > bestLen) { bestLen = len; bestIdx = i; }
      }
      const a = edge.points[bestIdx];
      const b = edge.points[bestIdx + 1];
      edge.labelPos = {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
      };
    }
  }
}

/** Check if an ortho segment (horizontal or vertical) intersects a rectangle */
function _segIntersectsRect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  left: number, top: number, right: number, bottom: number,
): boolean {
  if (Math.abs(p1.x - p2.x) < 0.5) {
    // Vertical segment
    const x = (p1.x + p2.x) / 2;
    const yMin = Math.min(p1.y, p2.y);
    const yMax = Math.max(p1.y, p2.y);
    return x > left && x < right && yMax > top && yMin < bottom;
  } else {
    // Horizontal segment
    const y = (p1.y + p2.y) / 2;
    const xMin = Math.min(p1.x, p2.x);
    const xMax = Math.max(p1.x, p2.x);
    return y > top && y < bottom && xMax > left && xMin < right;
  }
}

/**
 * Find intersections of an axis-aligned segment with a rect boundary.
 * Returns intersections ordered along the direction from p1 to p2.
 */
function _orthoSegRectIntersections(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number },
): Array<{ point: { x: number; y: number }; side: string }> {
  const result: Array<{ point: { x: number; y: number }; side: string; t: number }> = [];

  if (Math.abs(p1.x - p2.x) < 0.5) {
    // Vertical segment
    const x = (p1.x + p2.x) / 2;
    if (x <= rect.left || x >= rect.right) return [];
    const dy = p2.y - p1.y;
    if (Math.abs(dy) < 0.1) return [];
    const tTop = (rect.top - p1.y) / dy;
    if (tTop > 0.001 && tTop < 0.999) {
      result.push({ point: { x, y: rect.top }, side: 'top', t: tTop });
    }
    const tBot = (rect.bottom - p1.y) / dy;
    if (tBot > 0.001 && tBot < 0.999) {
      result.push({ point: { x, y: rect.bottom }, side: 'bottom', t: tBot });
    }
  } else {
    // Horizontal segment
    const y = (p1.y + p2.y) / 2;
    if (y <= rect.top || y >= rect.bottom) return [];
    const dx = p2.x - p1.x;
    if (Math.abs(dx) < 0.1) return [];
    const tLeft = (rect.left - p1.x) / dx;
    if (tLeft > 0.001 && tLeft < 0.999) {
      result.push({ point: { x: rect.left, y }, side: 'left', t: tLeft });
    }
    const tRight = (rect.right - p1.x) / dx;
    if (tRight > 0.001 && tRight < 0.999) {
      result.push({ point: { x: rect.right, y }, side: 'right', t: tRight });
    }
  }

  result.sort((a, b) => a.t - b.t);
  return result.map(r => ({ point: r.point, side: r.side }));
}

/**
 * Build intermediate corner points for a detour around a rect boundary,
 * from entry side to exit side.
 * CW corner order: TL(0) → TR(1) → BR(2) → BL(3)
 */
function _buildRectDetour(
  entrySide: string,
  exitSide: string,
  rect: { left: number; top: number; right: number; bottom: number },
  clockwise: boolean,
): Array<{ x: number; y: number }> {
  // Same side: direct connection, no corners needed
  if (entrySide === exitSide) return [];

  const corners = [
    { x: rect.left, y: rect.top },     // 0: TL
    { x: rect.right, y: rect.top },    // 1: TR
    { x: rect.right, y: rect.bottom }, // 2: BR
    { x: rect.left, y: rect.bottom },  // 3: BL
  ];

  // CW-end corner of each side (corner reached going CW along the side)
  const cwEnd: Record<string, number> = { top: 1, right: 2, bottom: 3, left: 0 };
  // CW-start corner of each side
  const cwStart: Record<string, number> = { top: 0, right: 1, bottom: 2, left: 3 };

  const path: Array<{ x: number; y: number }> = [];

  if (clockwise) {
    let c = cwEnd[entrySide];
    const target = cwStart[exitSide];
    let safety = 0;
    while (c !== target && safety < 4) {
      path.push({ ...corners[c] });
      c = (c + 1) % 4;
      safety++;
    }
    path.push({ ...corners[target] });
  } else {
    let c = cwStart[entrySide];
    const target = cwEnd[exitSide];
    let safety = 0;
    while (c !== target && safety < 4) {
      path.push({ ...corners[c] });
      c = (c + 3) % 4;
      safety++;
    }
    path.push({ ...corners[target] });
  }

  return path;
}

/** Compute total Manhattan length of an ortho point sequence */
function _orthoPathLen(pts: Array<{ x: number; y: number }>): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    len += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  }
  return len;
}

/**
 * Simplify backtrack detours in ortho edge routing.
 *
 * After node-avoidance routing, edges may contain U-turn patterns where
 * the path goes one direction, takes a short perpendicular step, then
 * reverses.  This function detects such patterns and collapses them.
 *
 * Detection: four consecutive points p1,p2,p3,p4 where p1→p2 and p3→p4
 * are parallel segments going in opposite directions (backtrack), and
 * the connecting segment p2→p3 is short (< threshold).
 *
 * Fix: move the shorter arm's outer point onto the longer arm's line,
 * then delete the two intermediate points.
 */
export function simplifyBacktrackEdges(layout: LayoutResult, threshold: number): void {
  if (!layout.edges) return;
  for (const edge of layout.edges) {
    const pts = edge.points;
    if (!pts || pts.length < 4) continue;

    let i = 0;
    while (i <= pts.length - 4) {
      const p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2], p4 = pts[i + 3];

      const isP1P2Vert = Math.abs(p1.x - p2.x) < 1;
      const isP3P4Vert = Math.abs(p3.x - p4.x) < 1;
      const isP1P2Horiz = Math.abs(p1.y - p2.y) < 1;
      const isP3P4Horiz = Math.abs(p3.y - p4.y) < 1;

      let simplified = false;

      if (isP1P2Vert && isP3P4Vert) {
        // Both arms vertical, connector p2→p3 horizontal
        const connLen = Math.abs(p3.x - p2.x);
        const backtrack = (p1.y > p2.y && p4.y > p3.y) || (p1.y < p2.y && p4.y < p3.y);
        if (backtrack && connLen < threshold) {
          const arm1 = Math.abs(p2.y - p1.y);
          const arm2 = Math.abs(p4.y - p3.y);
          if (arm1 <= arm2) {
            p1.x = p4.x;
          } else {
            p4.x = p1.x;
          }
          pts.splice(i + 1, 2);
          simplified = true;
        }
      } else if (isP1P2Horiz && isP3P4Horiz) {
        // Both arms horizontal, connector p2→p3 vertical
        const connLen = Math.abs(p3.y - p2.y);
        const backtrack = (p1.x > p2.x && p4.x > p3.x) || (p1.x < p2.x && p4.x < p3.x);
        if (backtrack && connLen < threshold) {
          const arm1 = Math.abs(p2.x - p1.x);
          const arm2 = Math.abs(p4.x - p3.x);
          if (arm1 <= arm2) {
            p1.y = p4.y;
          } else {
            p4.y = p1.y;
          }
          pts.splice(i + 1, 2);
          simplified = true;
        }
      }

      if (!simplified) i++;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer compression — merge solo-node layers into adjacent layers
// ---------------------------------------------------------------------------

/**
 * Compress layers by merging nodes that sit alone on a layer
 * into an adjacent layer, when edge-direction constraints allow it.
 *
 * For TB layout: layers are determined by Y center; merging means
 * adjusting Y to match the target layer's Y center.
 *
 * Only nodes that are solo on their layer are candidates.  A node
 * can merge UP (preferred) if all its predecessors are ≥2 layers above,
 * or merge DOWN if all its successors are ≥2 layers below.
 *
 * After merging, empty layer gaps are closed by shifting nodes upward.
 */
export function compressLayers(
  layout: LayoutResult,
  model: SemanticModel,
  isLR: boolean = false,
): void {
  const nodes = layout.nodes;
  const edges = model.edges;
  if (!edges || Object.keys(nodes).length === 0) return;

  // Build edge adjacency (forward direction only — from semantic model)
  const predsOf = new Map<string, string[]>();
  const succsOf = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodes[edge.from] || !nodes[edge.to]) continue;
    if (!predsOf.has(edge.to)) predsOf.set(edge.to, []);
    predsOf.get(edge.to)!.push(edge.from);
    if (!succsOf.has(edge.from)) succsOf.set(edge.from, []);
    succsOf.get(edge.from)!.push(edge.to);
  }

  // Rebuild layers from current positions
  const LAYER_TOLERANCE = 5;
  const buildLayers = (): { center: number; nodes: string[] }[] => {
    const coords: { id: string; center: number }[] = [];
    for (const [id, node] of Object.entries(nodes)) {
      const center = isLR ? node.x + node.width / 2 : node.y + node.height / 2;
      coords.push({ id, center });
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
    return layers;
  };

  const layers = buildLayers();
  if (layers.length < 3) return;

  // Build nodeId → layer index map
  const nodeLayerIdx = new Map<string, number>();
  for (let i = 0; i < layers.length; i++) {
    for (const nid of layers[i].nodes) nodeLayerIdx.set(nid, i);
  }

  // Check spatial overlap on the perpendicular axis (X for TB, Y for LR)
  const wouldOverlap = (nid: string, targetLayerNodes: string[], gap: number): boolean => {
    const n = nodes[nid];
    if (!n) return true;
    const nMin = isLR ? n.y : n.x;
    const nMax = isLR ? n.y + n.height : n.x + n.width;
    for (const otherId of targetLayerNodes) {
      const o = nodes[otherId];
      if (!o) continue;
      const oMin = isLR ? o.y : o.x;
      const oMax = isLR ? o.y + o.height : o.x + o.width;
      if (nMax + gap > oMin && oMax + gap > nMin) return true;
    }
    return false;
  };

  // Attempt to merge solo-node layers
  const merged = new Set<string>();
  const GAP = 20; // minimum spacing on perpendicular axis

  for (let li = 0; li < layers.length; li++) {
    if (layers[li].nodes.length !== 1) continue;
    const nid = layers[li].nodes[0];
    if (merged.has(nid)) continue;

    const preds = predsOf.get(nid) || [];
    const succs = succsOf.get(nid) || [];

    const predLayers = preds.map(p => nodeLayerIdx.get(p)).filter(l => l !== undefined) as number[];
    const succLayers = succs.map(s => nodeLayerIdx.get(s)).filter(l => l !== undefined) as number[];

    const maxPredLayer = predLayers.length > 0 ? Math.max(...predLayers) : -1;
    const minSuccLayer = succLayers.length > 0 ? Math.min(...succLayers) : layers.length;

    // Try merge UP first (preferred — moves toward predecessors)
    if (li > 0 && maxPredLayer < li - 1 && !wouldOverlap(nid, layers[li - 1].nodes, GAP)) {
      // Move node to layer li-1
      const targetCenter = layers[li - 1].center;
      const n = nodes[nid];
      if (isLR) {
        n.x = targetCenter - n.width / 2;
      } else {
        n.y = targetCenter - n.height / 2;
      }
      layers[li - 1].nodes.push(nid);
      layers[li].nodes = [];
      merged.add(nid);
      continue;
    }

    // Try merge DOWN
    if (li < layers.length - 1 && minSuccLayer > li + 1 && !wouldOverlap(nid, layers[li + 1].nodes, GAP)) {
      const targetCenter = layers[li + 1].center;
      const n = nodes[nid];
      if (isLR) {
        n.x = targetCenter - n.width / 2;
      } else {
        n.y = targetCenter - n.height / 2;
      }
      layers[li + 1].nodes.push(nid);
      layers[li].nodes = [];
      merged.add(nid);
      continue;
    }
  }

  if (merged.size === 0) return;

  // Close empty layer gaps: shift nodes upward to fill in removed layers
  const nonEmptyLayers = layers.filter(l => l.nodes.length > 0);
  if (nonEmptyLayers.length === layers.length) return;

  // Compute the shift needed: for each remaining layer, how much to shift
  // based on the gap between its current center and where it "should" be.
  // We keep the first non-empty layer in place, and shift subsequent layers
  // closer by the amount of removed layers × typical layer spacing.
  const removedCenters: number[] = [];
  for (const l of layers) {
    if (l.nodes.length === 0) removedCenters.push(l.center);
  }

  // For each node, compute how many removed layers are before it
  for (const [nid, node] of Object.entries(nodes)) {
    const nodeCenter = isLR ? node.x + node.width / 2 : node.y + node.height / 2;
    let shiftCount = 0;
    for (const rc of removedCenters) {
      if (rc < nodeCenter) shiftCount++;
    }
    if (shiftCount === 0) continue;

    // Estimate per-layer gap from the average distance between original consecutive layers
    const avgLayerGap = (layers[layers.length - 1].center - layers[0].center) / (layers.length - 1);
    const shift = shiftCount * avgLayerGap;

    if (isLR) {
      node.x -= shift;
      if (node.xlabelPos) node.xlabelPos.x -= shift;
    } else {
      node.y -= shift;
      if (node.xlabelPos) node.xlabelPos.y -= shift;
    }
  }

  // Also shift edge waypoints and label positions
  if (layout.edges) {
    for (const edge of layout.edges) {
      for (const pt of edge.points || []) {
        const coord = isLR ? pt.x : pt.y;
        let shiftCount = 0;
        for (const rc of removedCenters) {
          if (rc < coord) shiftCount++;
        }
        if (shiftCount === 0) continue;
        const avgLayerGap = (layers[layers.length - 1].center - layers[0].center) / (layers.length - 1);
        if (isLR) pt.x -= shiftCount * avgLayerGap;
        else pt.y -= shiftCount * avgLayerGap;
      }
      if (edge.labelPos) {
        const coord = isLR ? edge.labelPos.x : edge.labelPos.y;
        let shiftCount = 0;
        for (const rc of removedCenters) {
          if (rc < coord) shiftCount++;
        }
        if (shiftCount > 0) {
          const avgLayerGap = (layers[layers.length - 1].center - layers[0].center) / (layers.length - 1);
          if (isLR) edge.labelPos.x -= shiftCount * avgLayerGap;
          else edge.labelPos.y -= shiftCount * avgLayerGap;
        }
      }
      if (edge.cardFromPos) {
        const coord = isLR ? edge.cardFromPos.x : edge.cardFromPos.y;
        let shiftCount = 0;
        for (const rc of removedCenters) {
          if (rc < coord) shiftCount++;
        }
        if (shiftCount > 0) {
          const avgLayerGap = (layers[layers.length - 1].center - layers[0].center) / (layers.length - 1);
          if (isLR) edge.cardFromPos.x -= shiftCount * avgLayerGap;
          else edge.cardFromPos.y -= shiftCount * avgLayerGap;
        }
      }
      if (edge.cardToPos) {
        const coord = isLR ? edge.cardToPos.x : edge.cardToPos.y;
        let shiftCount = 0;
        for (const rc of removedCenters) {
          if (rc < coord) shiftCount++;
        }
        if (shiftCount > 0) {
          const avgLayerGap = (layers[layers.length - 1].center - layers[0].center) / (layers.length - 1);
          if (isLR) edge.cardToPos.x -= shiftCount * avgLayerGap;
          else edge.cardToPos.y -= shiftCount * avgLayerGap;
        }
      }
    }
  }

  // Shift groups
  if (layout.groups) {
    for (const g of Object.values(layout.groups)) {
      const gCenter = isLR ? g.x + g.width / 2 : g.y + g.height / 2;
      let shiftCountStart = 0, shiftCountEnd = 0;
      const gStart = isLR ? g.x : g.y;
      const gEnd = isLR ? g.x + g.width : g.y + g.height;
      for (const rc of removedCenters) {
        if (rc > gStart && rc < gEnd) {
          shiftCountEnd++;
        } else if (rc < gStart) {
          shiftCountStart++;
        }
      }
      const avgLayerGap = (layers[layers.length - 1].center - layers[0].center) / (layers.length - 1);
      // Shift position by layers removed before the group
      if (shiftCountStart > 0) {
        if (isLR) g.x -= shiftCountStart * avgLayerGap;
        else g.y -= shiftCountStart * avgLayerGap;
      }
      // Shrink size by layers removed inside the group
      if (shiftCountEnd > 0) {
        if (isLR) g.width -= shiftCountEnd * avgLayerGap;
        else g.height -= shiftCountEnd * avgLayerGap;
      }
    }
  }
}
