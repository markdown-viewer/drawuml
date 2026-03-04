/**
 * Layout post-processing — engine-agnostic adjustments applied after
 * any layout engine (DOT, ELK, …) produces raw coordinates.
 *
 * Extracted from dot-layout.ts so both DOT and future ELK pipelines
 * share the same post-processing logic.
 */

import type { LayoutResult, LayoutNode, LayoutGroup, LayoutEdge } from '../model/index.ts';
import type { SemanticModel, SemanticNode } from '../model/index.ts';
import { createTheme, type Theme } from '../shared/theme.ts';
import { computeTitleH } from '../primitives/index.ts';
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

/** A vertical or horizontal segment extracted from an edge's point list. */
interface EdgeSegment {
  edgeIdx: number;
  /** Index of the first point in the segment pair */
  ptIdx: number;
  /** Is this segment vertical (true) or horizontal (false)? */
  vertical: boolean;
  /** Constant coordinate (x for vertical, y for horizontal) */
  pos: number;
  /** Range start (y-min for vertical, x-min for horizontal) */
  rangeMin: number;
  /** Range end (y-max for vertical, x-max for horizontal) */
  rangeMax: number;
}

/**
 * Post-process edge routes to enforce minimum edge-edge spacing.
 *
 * ELK does not guarantee edge-edge spacing for cross-hierarchy edges
 * (edges routed through different hierarchy levels). This function
 * detects overlapping parallel edge segments and nudges them apart.
 */
export function separateOverlappingEdges(layout: LayoutResult, minGap: number): void {
  if (minGap <= 0) return;
  const edges = layout.edges;
  if (!edges || edges.length < 2) return;

  // Collect all axis-aligned segments from all edges
  const vertSegs: EdgeSegment[] = [];
  const horizSegs: EdgeSegment[] = [];
  for (let ei = 0; ei < edges.length; ei++) {
    const pts = edges[ei].points;
    if (!pts || pts.length < 2) continue;
    for (let pi = 0; pi < pts.length - 1; pi++) {
      const dx = Math.abs(pts[pi].x - pts[pi + 1].x);
      const dy = Math.abs(pts[pi].y - pts[pi + 1].y);
      if (dx < 0.5 && dy > 0.5) {
        // vertical segment
        vertSegs.push({
          edgeIdx: ei, ptIdx: pi, vertical: true,
          pos: pts[pi].x,
          rangeMin: Math.min(pts[pi].y, pts[pi + 1].y),
          rangeMax: Math.max(pts[pi].y, pts[pi + 1].y),
        });
      } else if (dy < 0.5 && dx > 0.5) {
        // horizontal segment
        horizSegs.push({
          edgeIdx: ei, ptIdx: pi, vertical: false,
          pos: pts[pi].y,
          rangeMin: Math.min(pts[pi].x, pts[pi + 1].x),
          rangeMax: Math.max(pts[pi].x, pts[pi + 1].x),
        });
      }
    }
  }

  // For each pair of parallel segments from DIFFERENT edges,
  // check if they overlap in range and are too close.
  _nudgeSegments(vertSegs, edges, minGap);
  _nudgeSegments(horizSegs, edges, minGap);
}

/**
 * Nudge overlapping parallel segments apart.
 * Mutates edge points in-place.
 */
function _nudgeSegments(
  segs: EdgeSegment[],
  edges: LayoutEdge[],
  minGap: number,
): void {
  // Sort by position so we can process neighbors
  segs.sort((a, b) => a.pos - b.pos);

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      // Different edges only
      if (a.edgeIdx === b.edgeIdx) continue;
      const gap = b.pos - a.pos;
      if (gap >= minGap) break; // sorted, so no more close pairs for this i
      // Check range overlap
      const overlapMin = Math.max(a.rangeMin, b.rangeMin);
      const overlapMax = Math.min(a.rangeMax, b.rangeMax);
      if (overlapMax <= overlapMin) continue;
      // Segments overlap and are too close — nudge them apart symmetrically
      const shift = (minGap - gap) / 2;
      _shiftSegment(a, edges, -shift);
      _shiftSegment(b, edges, shift);
      // Update pos for subsequent comparisons
      a.pos -= shift;
      b.pos += shift;
    }
  }
}

/**
 * Shift one segment along its perpendicular axis.
 * Updates both endpoints of the segment in the edge's point array.
 */
function _shiftSegment(seg: EdgeSegment, edges: LayoutEdge[], delta: number): void {
  const pts = edges[seg.edgeIdx].points!;
  if (seg.vertical) {
    pts[seg.ptIdx].x += delta;
    pts[seg.ptIdx + 1].x += delta;
  } else {
    pts[seg.ptIdx].y += delta;
    pts[seg.ptIdx + 1].y += delta;
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
  const PORT_SIZE = theme.sizeXS;
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
// Note field-level alignment
// ---------------------------------------------------------------------------

/**
 * Align notes that target specific class fields (memberTarget) so their
 * vertical center matches the corresponding field row within the class.
 */
export function alignFieldNotes(
  nodes: Record<string, LayoutNode>,
  notes: Array<{ id: string; position?: string; target?: string; memberTarget?: string }>,
  modelNodes: SemanticNode[],
  theme: Theme = createTheme(),
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

    // Calculate field center Y using proportional distribution
    const titleH = computeTitleH(targetNode);
    const bodyH = targetLayout.height - titleH;
    const numRows = targetNode.bodyLines.length;
    if (numRows === 0) continue;
    const rowSpacing = bodyH / numRows;
    const fieldCenterY = titleH + rowSpacing * (fieldIndex + 0.5);

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
    group.sort((a, b) => (nodes[a.id]?.y ?? 0) - (nodes[b.id]?.y ?? 0));
    for (let i = 1; i < group.length; i++) {
      const prev = nodes[group[i - 1].id];
      const cur = nodes[group[i].id];
      if (!prev || !cur) continue;
      const minY = prev.y + prev.height + theme.padS; // note overlap gap
      if (cur.y < minY) cur.y = minY;
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
 * DOT mode: lanes are already columnar (DOT clusters). Only normalize heights.
 */
function _rearrangeSwimlaneDot(
  layout: LayoutResult,
  group: { id: string; concurrentRegions: string[][]; children: string[] },
  containerPos: LayoutGroup,
): void {
  const regions = group.concurrentRegions;
  const numLanes = regions.length;

  // Collect region positions from layout engine
  const regionPositions: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
  for (let i = 0; i < numLanes; i++) {
    const regionId = `${group.id}.__conc_region__${i}`;
    const pos = layout.groups?.[regionId];
    if (pos) {
      regionPositions.push({ ...pos });
    }
  }

  if (regionPositions.length === 0) return;

  // Compute full container bounds from all regions and nodes
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const rp of regionPositions) {
    minX = Math.min(minX, rp.x);
    maxX = Math.max(maxX, rp.x + rp.width);
    minY = Math.min(minY, rp.y);
    maxY = Math.max(maxY, rp.y + rp.height);
  }

  // Also consider node extents (nodes may exceed cluster bounds)
  for (const nid of group.children) {
    const n = layout.nodes[nid];
    if (!n) continue;
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y + n.height);
  }

  const totalHeight = maxY - minY;

  // Update container to encompass all regions
  containerPos.x = minX;
  containerPos.y = minY;
  containerPos.width = maxX - minX;
  containerPos.height = totalHeight;

  // Set all regions to full container height, keep X/width from engine
  if (!layout.groups) layout.groups = {};
  for (let i = 0; i < numLanes; i++) {
    const regionId = `${group.id}.__conc_region__${i}`;
    const existing = layout.groups[regionId];
    if (existing) {
      existing.y = containerPos.y;
      existing.height = containerPos.height;
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
  const LANE_PAD = theme.padXL;
  const LANE_HEADER = theme.sizeS; // left-side title width for horizontal lanes

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
    const minLaneH = theme.padL * 2; // 80 at base 12
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

  const minGap = theme.padL;

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
  const margin = theme.padL / 3;
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
