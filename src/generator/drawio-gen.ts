import { edgeStyleForArrow, edgeStyleForType } from '../parsers/arrow.ts';
import { escapeXml, mxVertex, wrapMxfile, n4 } from '../shared/xml-utils.ts';
import { Renderer } from '../primitives/renderer.ts';
import { parseBracketEdgeStyle, parseEdgeInlineStyle } from '../shared/color-utils.ts';
import { buildEdgeCells } from '../shared/edge-builder.ts';
import { LabelRenderer } from '../primitives/shapes/label.ts';
import type { Theme } from '../shared/theme.ts';

export interface DrawioGenOptions {
  /** Layout engine used. Affects edge style (curved vs orthogonal). */
  engine?: 'dot' | 'elk';
  /** Computed theme for this conversion pass. */
  theme?: Theme;
}

export function semanticToDrawioXml(model, layout, renderers: Map<string, Renderer>, options?: DrawioGenOptions) {
  const engine = options?.engine ?? 'dot';
  const diagramId = 'diagram-1';
  const diagramName = 'Diagram';

  const cells = [];
  cells.push('<mxCell id="0"/>');
  cells.push('<mxCell id="1" parent="0"/>');

  // Build groupId set for compound edge detection
  const groups = model.groups || [];
  const groupIdSet = new Set<string>();
  for (const g of groups) {
    groupIdSet.add(g.id);
  }

  // Count edges per normalised (A, B) pair to detect parallel multi-edges.
  // Normalise by sorting so A→B and B→A count together.
  const edgePairCount = new Map<string, number>();
  for (const edge of model.edges) {
    const key = [edge.from, edge.to].sort().join('\0');
    edgePairCount.set(key, (edgePairCount.get(key) || 0) + 1);
  }

  // For each parallel edge group, determine which endpoint side has larger spread.
  // The larger-spread side's viz.js endpoint is kept as a waypoint (not promoted to
  // sourcePoint/targetPoint) so DrawIO computes distinct perimeter crossings for
  // each parallel edge via its floating endpoint calculation.
  const parallelSpreadSide = new Map<string, 'source' | 'target'>();
  for (const [key, count] of edgePairCount) {
    if (count < 2) continue;
    const groupEdges = (layout.edges || []).filter((le) => {
      const me = model.edges.find((e) => e.id === le.id);
      return me && [me.from, me.to].sort().join('\0') === key;
    });
    if (groupEdges.length < 2) continue;
    const maxSpread = (pts: Array<{ x: number; y: number } | undefined>) => {
      const valid = pts.filter(Boolean) as Array<{ x: number; y: number }>;
      let max = 0;
      for (let i = 0; i < valid.length; i++)
        for (let j = i + 1; j < valid.length; j++)
          max = Math.max(max, Math.hypot(valid[i].x - valid[j].x, valid[i].y - valid[j].y));
      return max;
    };
    const srcSpread = maxSpread(groupEdges.map((e) => e.points?.[0]));
    const tgtSpread = maxSpread(groupEdges.map((e) => e.points && e.points[e.points.length - 1]));
    parallelSpreadSide.set(key, tgtSpread >= srcSpread ? 'target' : 'source');
  }

  // Set layout reference so group renderers can look up child coordinates
  for (const r of renderers.values()) {
    if (!r.parentId) r.setLayoutRef(layout);
  }

  // Render all root elements (nodes, groups, notes, global elements).
  // Each group renderer renders its own direct children via renderChildren().
  for (const [id, r] of renderers) {
    if (r.parentId) continue; // children are rendered by their parent group
    if (r.isPort) continue;   // ports rendered separately below with absolute coords
    const l = layout.nodes[id] || (layout.groups || {})[id];
    if (!l) continue;
    cells.push(...r.render({ x: l.x, y: l.y, width: l.width, height: l.height, xlabelPos: (l as any).xlabelPos }));
  }

  // Port nodes straddle group boundaries, so render them with absolute coordinates
  // (not relative to their parent group).
  for (const node of model.nodes) {
    const r = renderers.get(node.id);
    if (!r?.isPort) continue;
    const l = layout.nodes[node.id];
    if (!l) continue;
    cells.push(...r.render({ x: l.x, y: l.y, width: l.width, height: l.height }));
  }

  // Edges
  const defaultStrokeWidth = options?.theme?.strokeWidth ?? 1;
  for (const edge of model.edges) {
    let style: string;
    if (edge.arrow) {
      style = edgeStyleForArrow(edge.arrow, edge.arrowMeta || null);
    } else {
      style = edgeStyleForType(edge.type);
    }

    // DOT edges use curved=1 for smooth B-spline rendering.
    // ELK edges use orthogonalEdgeStyle; routing direction is controlled
    // by waypoints placed in the gap between nodes.
    const hasPort = !!(edge.fromPort || edge.toPort);
    const le = layout.edges.find(e => e.id === edge.id);
    if (engine !== 'elk') {
      style += 'curved=1;';
    } else {
      style += `edgeStyle=orthogonalEdgeStyle;rounded=1;arcSize=${options?.theme?.arcSize ?? 4};`;
    }

    // Merge bracket style from arrowMeta.color or bodyToken bracket content
    const meta = edge.arrowMeta;
    let bracketContent = meta?.color || null;
    if (!bracketContent && meta?.bodyToken) {
      const m = meta.bodyToken.match(/\[([^\]]+)\]/);
      if (m) bracketContent = m[1];
    }
    const bracketStyle = parseBracketEdgeStyle(bracketContent);
    // Merge inline style from edge.style (e.g. "#line:red;line.bold;text:red")
    const inlineStyle = parseEdgeInlineStyle(edge.style);
    const es = { ...bracketStyle, ...inlineStyle };

    if (es.lineStyle === 'hidden') continue; // hidden edges are layout-only, not rendered

    if (es.strokeColor) style += `strokeColor=${es.strokeColor};`;
    if (es.textColor) style += `fontColor=${es.textColor};`;
    if (es.thickness) style += `strokeWidth=${es.thickness};`;
    if (es.lineStyle === 'dashed') style += 'dashed=1;';
    else if (es.lineStyle === 'dotted') style += 'dashed=1;dashPattern=1 2;';
    else if (es.lineStyle === 'bold') style += `strokeWidth=${n4(defaultStrokeWidth * 2)};`;
    else if (es.lineStyle === 'plain') { /* default solid — no extra style */ }

    // Apply default strokeWidth for edges (scaled from theme)
    if (!es.thickness && es.lineStyle !== 'bold' && !style.includes('strokeWidth=')) style += `strokeWidth=${defaultStrokeWidth};`;

    // Resolve source/target — use field-level port id when available
    const sourceId = edge.fromPort ? `${edge.from}::${edge.fromPort}` : edge.from;
    const targetId = edge.toPort ? `${edge.to}::${edge.toPort}` : edge.to;

    // Omit source/target cell references for group (compound) endpoints.
    // When an edge connects to a group, Graphviz (compound=true + lhead/ltail)
    // clips the B-spline at the cluster boundary and we store that endpoint in
    // sourcePoint/targetPoint.  If we also set source/target to the group cell,
    // drawio2svg's perimeter projection recalculates the endpoint by shooting a
    // ray from the cell center → nearest waypoint, which differs from the
    // Graphviz endpoint and causes visible path distortion (bends/twists near
    // the group border).  Omitting the cell reference lets drawio2svg use our
    // exact B-spline endpoint coordinates instead.
    //
    // Exception: group self-loops (from === to && both are groups).  Graphviz's
    // compound self-loop routes through the representative node interior, not
    // around the cluster boundary.  We keep source/target so DrawIO draws its
    // own self-loop around the group cell.
    const isGroupSelfLoop = edge.from === edge.to && groupIdSet.has(edge.from);
    let omitSource = !isGroupSelfLoop && groupIdSet.has(edge.from);
    let omitTarget = !isGroupSelfLoop && groupIdSet.has(edge.to);

    const layoutEdge = layout.edges?.find((le) => le.id === edge.id);
    let points = layoutEdge?.points || null;

    // For port edges (field-level connections), derive exit/entry side from
    // layout endpoints and add constraints so drawio2svg pins the connection
    // to the field cell's left/right border.
    if (hasPort && points && points.length >= 2) {
      const sides = computePortEdgeSides(points, edge, layout, renderers, options?.theme?.padS);
      if (sides.exitX != null) {
        style += `exitX=${n4(sides.exitX)};exitY=${n4(sides.exitY)};exitDx=0;exitDy=0;`;
      }
      if (sides.entryX != null) {
        style += `entryX=${n4(sides.entryX)};entryY=${n4(sides.entryY)};entryDx=0;entryDy=0;`;
      }
      // Strip endpoints that are handled by constraints; keep the rest
      const startIdx = sides.exitX != null ? 1 : 0;
      const endIdx = sides.entryX != null ? points.length - 1 : points.length;
      points = points.slice(startIdx, endIdx);
    }

    // Detect parallel multi-edges (same normalised A↔B pair).
    const pairKey = [edge.from, edge.to].sort().join('\0');

    // For ELK parallel edges, keep cell binding but add exit/entry
    // constraints to preserve ELK's calculated edge separation.
    // Without constraints, SegmentConnector's perimeter projection
    // merges parallel edges to the same routing center.
    if (engine === 'elk' && !hasPort && !omitSource && !omitTarget
        && (edgePairCount.get(pairKey) || 0) > 1
        && points && points.length >= 2) {
      const srcNode = layout.nodes[edge.from] || layout.groups?.[edge.from];
      const tgtNode = layout.nodes[edge.to] || layout.groups?.[edge.to];
      if (srcNode) {
        const sp = points[0];
        const exitX = Math.max(0, Math.min(1, (sp.x - srcNode.x) / srcNode.width));
        const exitY = Math.max(0, Math.min(1, (sp.y - srcNode.y) / srcNode.height));
        style += `exitX=${n4(exitX)};exitY=${n4(exitY)};exitDx=0;exitDy=0;`;
        points = points.slice(1); // strip source endpoint, now constrained
      }
      if (tgtNode) {
        const ep = points[points.length - 1];
        const entryX = Math.max(0, Math.min(1, (ep.x - tgtNode.x) / tgtNode.width));
        const entryY = Math.max(0, Math.min(1, (ep.y - tgtNode.y) / tgtNode.height));
        style += `entryX=${n4(entryX)};entryY=${n4(entryY)};entryDx=0;entryDy=0;`;
        points = points.slice(0, -1); // strip target endpoint, now constrained
      }
    }

    const isParallelEdge = !hasPort && !omitSource && !omitTarget
      && (edgePairCount.get(pairKey) || 0) > 1;

    // Compute geometry — unified for all edge types.
    // sourcePoint/targetPoint are used when the endpoint has no cell binding
    // (group endpoints use omitSource/omitTarget; port edges with constraints
    // have already stripped the constrained endpoints above).
    let geometry: { sourcePoint?: { x: number; y: number }; targetPoint?: { x: number; y: number }; waypoints?: { x: number; y: number }[] } | undefined;
    if (points && points.length >= 2) {
      if (isParallelEdge) {
        // For parallel edges, keep the viz.js endpoint of the larger-spread side
        // as a waypoint instead of promoting it to sourcePoint/targetPoint.
        // DrawIO's floating endpoint calculation uses the nearest waypoint as the
        // direction vector for perimeter projection — distinct endpoints on the
        // larger-spread side give each parallel edge a unique exit/entry point.
        const largerSide = parallelSpreadSide.get(pairKey) ?? 'target';
        if (largerSide === 'target') {
          // Source side: normal (sourcePoint = points[0], ignored by DrawIO when source cell set)
          // Target side: keep endpoint in waypoints as direction hint, no targetPoint
          geometry = {
            sourcePoint: points[0],
            waypoints: points.slice(1).length > 0 ? points.slice(1) : undefined,
          };
        } else {
          // Source side: keep endpoint in waypoints as direction hint, no sourcePoint
          // Target side: normal (targetPoint = points[last])
          const sliced = points.slice(0, -1);
          geometry = {
            waypoints: sliced.length > 0 ? sliced : undefined,
            targetPoint: points[points.length - 1],
          };
        }
      } else {
        // For ELK engine with cell-bound source+target (not groups/ports):
        // - 2 points (straight after simplification): pin both exit and entry
        //   constraints so drawio2svg doesn't re-route via perimeter projection.
        //   exitPerimeter=0 / entryPerimeter=0 prevents perimeter point recalc.
        // - 3+ points (polyline): pass all points as waypoints, no constraints,
        //   let DrawIO's orthogonal algorithm handle both endpoints.
        const cellBound = engine === 'elk' && !omitSource && !omitTarget && !hasPort;
        if (cellBound) {
          if (points.length === 2) {
            // Straight line: place 2 waypoints in the gap between source and
            // target nodes to guide SegmentConnector's routing direction.
            // Waypoints must be outside both node bounds to survive the
            // contains() filter in SegmentConnector. Using the midpoint
            // between endpoints (guaranteed in the gap) with a ±1 offset.
            const p0 = points[0], p1 = points[1];
            const midX = (p0.x + p1.x) / 2;
            const midY = (p0.y + p1.y) / 2;
            const isVertical = Math.abs(p0.x - p1.x) <= Math.abs(p0.y - p1.y);
            if (isVertical) {
              geometry = { waypoints: [{ x: midX, y: midY - 1 }, { x: midX, y: midY + 1 }] };
            } else {
              geometry = { waypoints: [{ x: midX - 1, y: midY }, { x: midX + 1, y: midY }] };
            }
          } else {
            // Polyline: pass all points as waypoints, no exit/entry constraints
            geometry = { waypoints: points };
          }
        } else {
        const needSourcePt = omitSource || !hasPort;
        const needTargetPt = omitTarget || !hasPort;
        const sp = needSourcePt ? points[0] : undefined;
        const tp = needTargetPt ? points[points.length - 1] : undefined;
        const startIdx = sp ? 1 : 0;
        const endIdx = tp ? points.length - 1 : points.length;
        const midPts = points.slice(startIdx, endIdx);
        geometry = {
          sourcePoint: sp,
          targetPoint: tp,
          waypoints: midPts.length > 0 ? midPts : undefined,
        };
        }
      }
    } else if (points && points.length > 0) {
      // Only waypoints remain (e.g. port edge with both endpoints constrained)
      geometry = { waypoints: points };
    }

    const layoutCardFromPos = layoutEdge?.cardFromPos;
    const layoutCardToPos = layoutEdge?.cardToPos;
    const layoutLabelPos = layoutEdge?.labelPos;
    const layoutLabelSize = layoutEdge?.labelSize;
    cells.push(...buildEdgeCells({
      id: edge.id,
      // Only pass label to buildEdgeCells when no ELK layout position is available;
      // positioned labels are emitted as standalone absolute-position cells below.
      label: layoutLabelPos ? undefined : edge.label,
      style,
      source: omitSource ? undefined : sourceId,
      target: omitTarget ? undefined : targetId,
      geometry,
      // Only pass card labels to buildEdgeCells when no layout position is available;
      // positioned labels are emitted as standalone absolute-position cells below.
      cardFrom: layoutCardFromPos ? undefined : edge.cardFrom,
      cardTo: layoutCardToPos ? undefined : edge.cardTo,
      fontSize: options?.theme?.fontSize,
      fontFamily: options?.theme?.fontFamily,
    }));
    // Edge center label at layout-computed absolute position
    if (edge.label && layoutLabelPos) {
      const lr = new LabelRenderer({ id: edge.id + '__label', label: edge.label, theme: options?.theme });
      const m = lr.measure();
      const w = layoutLabelSize?.width || m.width;
      const h = layoutLabelSize?.height || m.height;
      // Adjust label position to maintain gap from edge line
      const adjustedPos = adjustLabelAwayFromEdge(
        layoutLabelPos, { width: w, height: h },
        layoutEdge?.points, options?.theme?.padXS ?? 4,
      );
      cells.push(...lr.render({
        x: adjustedPos.x - w / 2,
        y: adjustedPos.y - h / 2,
        width: w, height: h,
      }));
    }
    // Cardinality labels at Graphviz-computed taillabel/headlabel positions
    if (edge.cardFrom && layoutCardFromPos) {
      const cfr = new LabelRenderer({ id: edge.id + '__cardFrom', label: edge.cardFrom, theme: options?.theme });
      const m = cfr.measure();
      cells.push(...cfr.render({
        x: layoutCardFromPos.x - m.width / 2,
        y: layoutCardFromPos.y - m.height / 2,
        width: m.width, height: m.height,
      }));
    }
    if (edge.cardTo && layoutCardToPos) {
      const ctr = new LabelRenderer({ id: edge.id + '__cardTo', label: edge.cardTo, theme: options?.theme });
      const m = ctr.measure();
      cells.push(...ctr.render({
        x: layoutCardToPos.x - m.width / 2,
        y: layoutCardToPos.y - m.height / 2,
        width: m.width, height: m.height,
      }));
    }
  }

  // Note-to-target dashed connection edges (skip link notes — they have no connector)
  for (const note of model.notes || []) {
    if (!note.target || note.onLink) continue;
    const noteLayout = layout.nodes[note.id];
    const targetLayout = layout.nodes[note.target];
    if (!noteLayout || !targetLayout) continue;
    const edgeId = `__note_edge_${note.id}`;
    const noteLinkColor = options?.theme?.noteLinkColor ?? '#AEAE8F';
    const style = `endArrow=none;dashed=1;strokeColor=${noteLinkColor};strokeWidth=${defaultStrokeWidth};`;
    // Resolve member-level target: match "A::counter" to field cell id "A::int counter"
    let edgeTarget = note.target;
    if (note.memberTarget) {
      const sep = note.memberTarget.indexOf('::');
      if (sep >= 0) {
        const classId = note.memberTarget.slice(0, sep);
        const memberName = note.memberTarget.slice(sep + 2);
        // Find matching node to search its bodyLines
        const targetNode = model.nodes.find((n) => n.id === classId);
        if (targetNode?.bodyLines) {
          for (const bl of targetNode.bodyLines) {
            const text = typeof bl === 'string' ? bl : bl.text;
            // Strip visibility prefix and check if the line contains the member name
            const stripped = text.replace(/^[+\-#~*]\s*/, '').trim();
            if (stripped === memberName || stripped.includes(memberName)) {
              const colonIdx = stripped.indexOf(':');
              const fieldName = colonIdx >= 0 ? stripped.slice(0, colonIdx).trim() : stripped;
              if (fieldName) {
                edgeTarget = `${classId}::${fieldName}`;
                break;
              }
            }
          }
        }
      }
    }
    // Add exit/entry constraints based on note position so the edge
    // connects at the correct border instead of routing through the class.
    let entryExit = '';
    const pos = (note.position || '').toLowerCase();
    if (pos === 'left') {
      entryExit = 'exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;';
    } else if (pos === 'right') {
      entryExit = 'exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;';
    } else if (pos === 'top') {
      entryExit = 'exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;';
    } else if (pos === 'bottom') {
      entryExit = 'exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;';
    }
    const fullStyle = style + entryExit;
    cells.push(...buildEdgeCells({
      id: edgeId,
      style: fullStyle,
      source: note.id,
      target: edgeTarget,
      fontSize: options?.theme?.fontSize,
      fontFamily: options?.theme?.fontFamily,
    }));
  }

  return wrapMxfile(cells, { diagramId, diagramName });
}

// ---------------------------------------------------------------------------
// Port edge side computation
// ---------------------------------------------------------------------------

/**
 * Derive exit/entry side (left=0, right=1) from DOT endpoint positions.
 *
 * DOT's B-spline endpoints are near the table edge for normal edges, but
 * may be in the interior for self-referencing loops or unusual routing.
 * Only assign a side constraint when the endpoint is within EDGE_SNAP_PX
 * of the node's left or right border; otherwise return null (no constraint).
 */

/** Clamp a value to [0, 1] and round to 4 decimal places for exit/entry constraints. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function computePortEdgeSides(
  points: { x: number; y: number }[],
  edge: any,
  layout: any,
  renderers?: Map<string, Renderer>,
  edgeSnapPx?: number,
): { exitX: number | null; exitY: number; entryX: number | null; entryY: number } {
  const EDGE_SNAP_PX = edgeSnapPx ?? 10;
  let exitX: number | null = null;
  let exitY: number = 0.5;
  let entryX: number | null = null;
  let entryY: number = 0.5;

  const srcNode = layout.nodes[edge.from];
  if (srcNode) {
    const sp = points[0];
    const distLeft = Math.abs(sp.x - srcNode.x);
    const distRight = Math.abs(sp.x - (srcNode.x + srcNode.width));
    if (distLeft <= EDGE_SNAP_PX) exitX = 0;
    else if (distRight <= EDGE_SNAP_PX) exitX = 1;
    // else: endpoint is in the interior — don't constrain

    // Compute precise exitY relative to the field row cell
    if (exitX != null && edge.fromPort && renderers) {
      exitY = computePortRelativeY(sp.y, edge.from, edge.fromPort, srcNode, renderers);
    }
  }

  const tgtNode = layout.nodes[edge.to];
  if (tgtNode) {
    const ep = points[points.length - 1];
    const distLeft = Math.abs(ep.x - tgtNode.x);
    const distRight = Math.abs(ep.x - (tgtNode.x + tgtNode.width));
    if (distLeft <= EDGE_SNAP_PX) entryX = 0;
    else if (distRight <= EDGE_SNAP_PX) entryX = 1;

    // Compute precise entryY relative to the field row cell
    if (entryX != null && edge.toPort && renderers) {
      entryY = computePortRelativeY(ep.y, edge.to, edge.toPort, tgtNode, renderers);
    }
  }

  return { exitX, exitY, entryX, entryY };
}

/**
 * Compute the relative Y position of an edge endpoint within a port (field row).
 *
 * Uses the renderer's port definitions to find the field row's absolute Y bounds,
 * then returns the endpoint's relative Y within that row (0 = top, 1 = bottom).
 * Falls back to 0.5 (center) if the port info is unavailable.
 */
function computePortRelativeY(
  endpointY: number,
  parentId: string,
  portName: string,
  parentNode: { x: number; y: number; width: number; height: number },
  renderers: Map<string, Renderer>,
): number {
  const renderer = renderers.get(parentId);
  if (!renderer) return 0.5;
  const layoutGraph = renderer.buildLayoutGraph();
  if (!layoutGraph.ports) return 0.5;
  const portId = `${parentId}::${portName}`;
  const port = layoutGraph.ports.find(p => p.id === portId);
  if (!port || port.y == null) return 0.5;
  const portAbsY = parentNode.y + port.y;
  const relY = (endpointY - portAbsY) / port.height;
  return clamp01(relY);
}

// ---------------------------------------------------------------------------
// Edge label gap enforcement
// ---------------------------------------------------------------------------

/**
 * Adjust a label center position so the label box maintains a minimum gap
 * from the nearest edge segment.
 *
 * For a vertical segment at x=Ex with label to the right: ensure
 * label-left >= Ex + gap.  For label to the left: ensure label-right <= Ex - gap.
 * Horizontal segments are handled analogously.
 */
function adjustLabelAwayFromEdge(
  labelCenter: { x: number; y: number },
  labelSize: { width: number; height: number },
  edgePoints: { x: number; y: number }[] | undefined,
  gap: number,
): { x: number; y: number } {
  if (!edgePoints || edgePoints.length < 2) return labelCenter;

  // Find the edge segment that vertically spans the label center
  let edgeX: number | undefined;
  for (let i = 0; i < edgePoints.length - 1; i++) {
    const p1 = edgePoints[i], p2 = edgePoints[i + 1];
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    if (labelCenter.y >= minY - 1 && labelCenter.y <= maxY + 1) {
      if (Math.abs(p2.y - p1.y) < 1) {
        edgeX = (p1.x + p2.x) / 2;
      } else {
        const t = (labelCenter.y - p1.y) / (p2.y - p1.y);
        edgeX = p1.x + t * (p2.x - p1.x);
      }
      break;
    }
  }
  if (edgeX === undefined) return labelCenter;

  const halfW = labelSize.width / 2;
  const labelLeft = labelCenter.x - halfW;
  const labelRight = labelCenter.x + halfW;

  let newX = labelCenter.x;
  if (labelCenter.x >= edgeX) {
    // Label is to the right of edge line
    const minLeft = edgeX + gap;
    if (labelLeft < minLeft) {
      newX = minLeft + halfW;
    }
  } else {
    // Label is to the left of edge line
    const maxRight = edgeX - gap;
    if (labelRight > maxRight) {
      newX = maxRight - halfW;
    }
  }

  return { x: newX, y: labelCenter.y };
}

