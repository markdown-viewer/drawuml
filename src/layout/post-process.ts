/**
 * Layout post-processing — engine-agnostic adjustments applied after
 * any layout engine (DOT, ELK, …) produces raw coordinates.
 *
 * Extracted from dot-layout.ts so both DOT and future ELK pipelines
 * share the same post-processing logic.
 */

import type { LayoutResult, LayoutNode, LayoutGroup } from '../model/index.ts';
import type { SemanticModel, SemanticNode } from '../model/index.ts';
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
  return { x: Math.round(candidates[0].x), y: Math.round(candidates[0].y) };
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
          return [{ x: Math.round(cross.x), y: Math.round(cross.y) }, ...points.slice(i + 1)];
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
          return [...points.slice(0, i), { x: Math.round(cross.x), y: Math.round(cross.y) }];
        }
      }
      if (!p2Inside) return points;
    }
    const snapped = snapToGroupBoundary(points[points.length - 1], g);
    return [...points.slice(0, -1), snapped];
  }
}

// ---------------------------------------------------------------------------
// Port node snapping
// ---------------------------------------------------------------------------

const PORT_HALF = 6; // half of PORT_SIZE (12px)
const PORT_SIZE = PORT_HALF * 2;

/**
 * Snap port nodes to their parent group boundary after layout,
 * then clip edge waypoints for edges that cross the port from outside the group.
 */
export function snapPortNodes(
  layout: LayoutResult,
  model: SemanticModel,
  renderers: Map<string, Renderer>,
): void {
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
              portNode.x = Math.round(cross.x) - PORT_HALF;
              portNode.y = Math.round(cross.y) - PORT_HALF;
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
    x: Math.round(titleX),
    y: Math.round(titleY),
    width: sz.width,
    height: sz.height,
  };
}
