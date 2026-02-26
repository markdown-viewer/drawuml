/**
 * ELK extractor — converts ELK layout output into a LayoutResult.
 *
 * ELK coordinates are already top-down (matching DrawIO), so no
 * Y-axis flip is needed (unlike DOT which uses bottom-up).
 *
 * Child node positions in ELK are relative to their parent container.
 * This extractor converts them to absolute coordinates.
 */

import type { LayoutResult, LayoutNode, LayoutEdge, LayoutGroup } from '../../model/index.ts';
import type { SemanticEdge } from '../../model/index.ts';
import type { ElkNode, ElkEdge } from './elk-adapter.ts';
import { Renderer } from '../../primitives/renderer.ts';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Extract layout results from a laid-out ELK graph.
 *
 * @param elkResult - The root ElkNode after ELK layout (with x/y populated)
 * @param edges     - Original semantic edges (for id/from/to mapping)
 * @param renderers - Renderer map for measure() fallback
 * @param groupIds  - Set of IDs that are groups (for edge group detection)
 */
export function extractElkLayout(
  elkResult: ElkNode,
  edges: SemanticEdge[],
  renderers: Map<string, Renderer>,
  groupIds: Set<string>,
): LayoutResult {
  const nodes: Record<string, LayoutNode> = {};
  const groups: Record<string, LayoutGroup> = {};

  // Walk the ELK tree, collecting node positions (converted to absolute coords)
  collectNodes(elkResult, 0, 0, nodes, groups, groupIds, renderers);

  // Extract edges — no endpoint offset needed because the ELK adapter
  // already uses icon-only node dimensions for nodes with graphicCenterOffset,
  // so ELK routes edges directly to the icon center.
  const layoutEdges = extractEdges(elkResult, edges, groupIds);

  // Post-process: simplify minor orthogonal bends caused by ELK's
  // uniform port distribution on node borders.
  for (const le of layoutEdges) {
    if (le.points && le.points.length > 2) {
      le.points = simplifyOrthogonalEdge(le.points);
    }
  }

  return {
    nodes,
    edges: layoutEdges,
    groups: Object.keys(groups).length > 0 ? groups : undefined,
  };
}

// ---------------------------------------------------------------------------
// Node collection (recursive, converts relative → absolute coords)
// ---------------------------------------------------------------------------

function collectNodes(
  elkNode: ElkNode,
  parentX: number,
  parentY: number,
  nodes: Record<string, LayoutNode>,
  groups: Record<string, LayoutGroup>,
  groupIds: Set<string>,
  renderers: Map<string, Renderer>,
): void {
  if (!elkNode.children) return;

  for (const child of elkNode.children) {
    const absX = parentX + (child.x ?? 0);
    const absY = parentY + (child.y ?? 0);
    const w = child.width ?? 0;
    const h = child.height ?? 0;

    if (child.children && child.children.length > 0) {
      // Container node → record as group
      groups[child.id] = {
        id: child.id,
        x: Math.round(absX),
        y: Math.round(absY),
        width: Math.round(w),
        height: Math.round(h),
      };
      // Recurse into children
      collectNodes(child, absX, absY, nodes, groups, groupIds, renderers);
    } else {
      // Leaf node → record as layout node
      // Use renderer's measure() for accurate size if available
      const r = renderers.get(child.id);
      const knownSize = r ? r.measure() : undefined;
      const nodeW = knownSize ? knownSize.width : w;
      const nodeH = knownSize ? knownSize.height : h;

      const layoutNode: LayoutNode = {
        id: child.id,
        x: Math.round(absX),
        y: Math.round(absY),
        width: Math.round(nodeW),
        height: Math.round(nodeH),
      };

      // External label position
      if (child.labels && child.labels.length > 0) {
        const label = child.labels[0];
        if (label.x !== undefined && label.y !== undefined) {
          layoutNode.xlabelPos = {
            x: Math.round(absX + label.x + (label.width / 2)),
            y: Math.round(absY + label.y + (label.height / 2)),
          };
        }
      }

      // NOTE: Unlike DOT (which gives center coords and needs offset to derive
      // top-left), ELK gives top-left coords directly.  Do NOT apply
      // graphicCenterOffset here — it is only needed for edge endpoints
      // (to shift from bounding-box center to icon center).

      nodes[child.id] = layoutNode;
    }
  }
}

// ---------------------------------------------------------------------------
// Edge extraction
// ---------------------------------------------------------------------------

/**
 * Extract edge waypoints from ELK layout result.
 *
 * ELK routes edges as `sections`, each with startPoint, endPoint,
 * and optional bendPoints. Coordinates are relative to the edge's
 * container node, so we need to find and apply parent offsets.
 */
function extractEdges(
  elkRoot: ElkNode,
  semanticEdges: SemanticEdge[],
  groupIds: Set<string>,
): LayoutEdge[] {
  // Build a map of node absolute positions for container offset lookup
  const containerOffsets = new Map<string, { x: number; y: number }>();
  buildContainerOffsets(elkRoot, 0, 0, containerOffsets);

  // Build edge id → semantic edge map for from/to lookup
  const edgeMap = new Map<string, SemanticEdge>();
  for (const e of semanticEdges) {
    edgeMap.set(e.id, e);
  }

  // Collect edges from all levels of the hierarchy
  const allElkEdges: Array<{ edge: ElkEdge; containerId: string }> = [];
  collectElkEdges(elkRoot, allElkEdges);

  const layoutEdges: LayoutEdge[] = [];

  for (const { edge: elkEdge, containerId } of allElkEdges) {
    const semanticEdge = edgeMap.get(elkEdge.id);
    if (!semanticEdge) continue;

    // Container offset for converting relative edge coords to absolute
    const offset = containerOffsets.get(containerId) ?? { x: 0, y: 0 };

    // Extract waypoints from sections
    const points: Array<{ x: number; y: number }> = [];
    if (elkEdge.sections) {
      for (const section of (elkEdge as any).sections) {
        if (section.startPoint) {
          points.push({
            x: Math.round(section.startPoint.x + offset.x),
            y: Math.round(section.startPoint.y + offset.y),
          });
        }
        if (section.bendPoints) {
          for (const bp of section.bendPoints) {
            points.push({
              x: Math.round(bp.x + offset.x),
              y: Math.round(bp.y + offset.y),
            });
          }
        }
        if (section.endPoint) {
          points.push({
            x: Math.round(section.endPoint.x + offset.x),
            y: Math.round(section.endPoint.y + offset.y),
          });
        }
      }
    }

    // For direction-inverted edges, reverse waypoints back
    const isInverted = semanticEdge.direction === 'left' || semanticEdge.direction === 'up';
    if (isInverted && points.length > 1) {
      points.reverse();
    }

    // Extract edge label position (ELK places it in edge.labels[0])
    let labelPos: { x: number; y: number } | undefined;
    let labelSize: { width: number; height: number } | undefined;
    if (elkEdge.labels && elkEdge.labels.length > 0) {
      const lbl = elkEdge.labels[0];
      if (lbl.x !== undefined && lbl.y !== undefined) {
        labelPos = {
          x: Math.round(offset.x + lbl.x + (lbl.width || 0) / 2),
          y: Math.round(offset.y + lbl.y + (lbl.height || 0) / 2),
        };
        labelSize = { width: Math.ceil(lbl.width || 0), height: Math.ceil(lbl.height || 0) };
      }
    }

    layoutEdges.push({
      id: semanticEdge.id,
      from: semanticEdge.from,
      to: semanticEdge.to,
      points,
      labelPos,
      labelSize,
      fromGroup: groupIds.has(semanticEdge.from) ? semanticEdge.from : undefined,
      toGroup: groupIds.has(semanticEdge.to) ? semanticEdge.to : undefined,
    });
  }

  return layoutEdges;
}

// ---------------------------------------------------------------------------
// Container offset helpers
// ---------------------------------------------------------------------------

/**
 * Build a map of container id → absolute offset.
 */
function buildContainerOffsets(
  node: ElkNode,
  parentX: number,
  parentY: number,
  offsets: Map<string, { x: number; y: number }>,
): void {
  const absX = parentX + (node.x ?? 0);
  const absY = parentY + (node.y ?? 0);
  offsets.set(node.id, { x: absX, y: absY });

  if (node.children) {
    for (const child of node.children) {
      buildContainerOffsets(child, absX, absY, offsets);
    }
  }
}

/**
 * Recursively collect all ELK edges from the hierarchy, along with
 * their container node id (needed for coordinate offset).
 */
function collectElkEdges(
  node: ElkNode,
  result: Array<{ edge: ElkEdge; containerId: string }>,
): void {
  if (node.edges) {
    for (const edge of node.edges) {
      result.push({ edge, containerId: node.id });
    }
  }
  if (node.children) {
    for (const child of node.children) {
      collectElkEdges(child, result);
    }
  }
}

// ---------------------------------------------------------------------------
// Edge simplification — remove minor orthogonal bends
// ---------------------------------------------------------------------------

// Maximum pixel offset to consider a Z-bend "minor" and eligible for merging
const BEND_THRESHOLD = 5;
// Tolerance for treating coordinates as collinear
const COL_TOL = 1;

/**
 * Simplify an orthogonal edge path in two passes:
 *
 * Pass 1 — Remove collinear intermediate points (three consecutive points
 *          sharing the same x or y within tolerance).
 *
 * Pass 2 — Merge small Z-bends: four consecutive points forming a
 *          V-H-V or H-V-H pattern where the offset between the two
 *          parallel segments is below BEND_THRESHOLD.  The two inner
 *          points are removed and the outer two are averaged onto a
 *          single midline, which naturally stays within the original
 *          polyline bounds.
 */
function simplifyOrthogonalEdge(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  // Pass 1: remove collinear intermediate points
  const cleaned = removeCollinearPoints(points);

  // Pass 2: merge small Z-bends
  if (cleaned.length < 4) return cleaned;

  const result: Array<{ x: number; y: number }> = [];
  let i = 0;
  while (i < cleaned.length) {
    if (i + 3 < cleaned.length) {
      const a = cleaned[i];
      const b = cleaned[i + 1];
      const c = cleaned[i + 2];
      const d = cleaned[i + 3];

      // V-H-V: a→b vertical, b→c horizontal (small), c→d vertical
      if (
        a.x === b.x && b.y === c.y && c.x === d.x &&
        a.x !== d.x && Math.abs(a.x - d.x) <= BEND_THRESHOLD
      ) {
        const midX = Math.round((a.x + d.x) / 2);
        result.push({ x: midX, y: a.y });
        result.push({ x: midX, y: d.y });
        i += 4;
        continue;
      }

      // H-V-H: a→b horizontal, b→c vertical (small), c→d horizontal
      if (
        a.y === b.y && b.x === c.x && c.y === d.y &&
        a.y !== d.y && Math.abs(a.y - d.y) <= BEND_THRESHOLD
      ) {
        const midY = Math.round((a.y + d.y) / 2);
        result.push({ x: a.x, y: midY });
        result.push({ x: d.x, y: midY });
        i += 4;
        continue;
      }
    }

    result.push(cleaned[i]);
    i++;
  }

  return result;
}

/**
 * Remove collinear intermediate points from an orthogonal path.
 * Three consecutive points with the same x (or same y) within tolerance
 * indicate the middle point is redundant.
 */
function removeCollinearPoints(
  points: Array<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  const result: Array<{ x: number; y: number }> = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const cur = points[i];
    const next = points[i + 1];
    const collinearX = Math.abs(prev.x - cur.x) <= COL_TOL && Math.abs(cur.x - next.x) <= COL_TOL;
    const collinearY = Math.abs(prev.y - cur.y) <= COL_TOL && Math.abs(cur.y - next.y) <= COL_TOL;
    if (!collinearX && !collinearY) {
      result.push(cur);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}
