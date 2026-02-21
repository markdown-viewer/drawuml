import { edgeStyleForArrow, edgeStyleForType } from '../parsers/arrow.ts';
import { escapeXml, mxVertex, wrapMxfile } from '../shared/xml-utils.ts';
import { Renderer } from '../primitives/renderer.ts';
import { parseBracketEdgeStyle, parseEdgeInlineStyle } from '../shared/color-utils.ts';
import { buildEdgeCells } from '../shared/edge-builder.ts';
import { NOTE_LINK_COLOR } from '../shared/theme.ts';

export function semanticToDrawioXml(model, layout, renderers: Map<string, Renderer>) {
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

  // Set layout reference so group renderers can look up child coordinates
  for (const r of renderers.values()) {
    if (!r.parentId) r.setLayoutRef(layout);
  }

  // Render all root elements (nodes, groups, notes, global elements).
  // Each group renderer renders its own direct children via renderChildren().
  for (const [id, r] of renderers) {
    if (r.parentId) continue; // children are rendered by their parent group
    const l = layout.nodes[id] || (layout.groups || {})[id];
    if (!l) continue;
    cells.push(...r.render({ x: l.x, y: l.y, width: l.width, height: l.height }));
  }

  // Edges
  for (const edge of model.edges) {
    let style: string;
    if (edge.arrow) {
      style = edgeStyleForArrow(edge.arrow, edge.arrowMeta || null);
    } else {
      style = edgeStyleForType(edge.type);
    }

    // All edges use curved=1 for smooth rendering.
    // Port edges also use DOT waypoints (with obstacle avoidance);
    // exit/entry constraints pin connections to the field cell's left/right border.
    const hasPort = !!(edge.fromPort || edge.toPort);
    style += 'curved=1;';

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
    else if (es.lineStyle === 'bold') style += 'strokeWidth=2;';
    else if (es.lineStyle === 'plain') { /* default solid — no extra style */ }

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

    // For port edges, derive exit/entry side from DOT endpoints and add
    // constraints so drawio2svg pins the connection to the field cell border.
    // Only strip the endpoint when we actually constrain that side; endpoints
    // that are NOT near the node border (e.g. self-referencing loops) are kept.
    if (hasPort && points && points.length >= 2) {
      const sides = computePortEdgeSides(points, edge, layout);
      if (sides.exitX != null) {
        style += `exitX=${sides.exitX};exitY=0.5;exitDx=0;exitDy=0;exitPerimeter=0;`;
      }
      if (sides.entryX != null) {
        style += `entryX=${sides.entryX};entryY=0.5;entryDx=0;entryDy=0;entryPerimeter=0;`;
      }
      // Strip endpoints that are handled by constraints; keep the rest
      const startIdx = sides.exitX != null ? 1 : 0;
      const endIdx = sides.entryX != null ? points.length - 1 : points.length;
      points = points.slice(startIdx, endIdx);
    }

    // Compute geometry based on edge type
    let geometry: { sourcePoint?: { x: number; y: number }; targetPoint?: { x: number; y: number }; waypoints?: { x: number; y: number }[] } | undefined;
    if (!hasPort && points && points.length >= 2) {
      const midPoints = points.slice(1, -1);
      geometry = {
        sourcePoint: points[0],
        targetPoint: points[points.length - 1],
        waypoints: midPoints.length > 0 ? midPoints : undefined,
      };
    } else if (hasPort && points && points.length > 0) {
      // Port edges with a group endpoint: the group side has no cell ref
      // (omitSource/omitTarget), so we must provide an explicit coordinate
      // via sourcePoint/targetPoint instead of relying on DrawIO cell binding.
      if (omitSource || omitTarget) {
        const sp = omitSource && points.length >= 1 ? points[0] : undefined;
        const tp = omitTarget && points.length >= 1 ? points[points.length - 1] : undefined;
        const startIdx = sp ? 1 : 0;
        const endIdx = tp ? points.length - 1 : points.length;
        const midPts = points.slice(startIdx, endIdx);
        geometry = {
          sourcePoint: sp,
          targetPoint: tp,
          waypoints: midPts.length > 0 ? midPts : undefined,
        };
      } else {
        geometry = { waypoints: points };
      }
    }

    cells.push(...buildEdgeCells({
      id: edge.id,
      label: edge.label,
      style,
      source: omitSource ? undefined : sourceId,
      target: omitTarget ? undefined : targetId,
      geometry,
      cardFrom: edge.cardFrom,
      cardTo: edge.cardTo,
    }));
  }

  // Notes
  for (const note of model.notes || []) {
    const l = layout.nodes[note.id];
    if (!l) continue;
    const r = renderers.get(note.id);
    if (r) cells.push(...r.render({ x: l.x, y: l.y, width: l.width, height: l.height }));
  }

  // Note-to-target dashed connection edges (skip link notes — they have no connector)
  for (const note of model.notes || []) {
    if (!note.target || note.onLink) continue;
    const noteLayout = layout.nodes[note.id];
    const targetLayout = layout.nodes[note.target];
    if (!noteLayout || !targetLayout) continue;
    const edgeId = `__note_edge_${note.id}`;
    const style = `endArrow=none;dashed=1;strokeColor=${NOTE_LINK_COLOR};`;
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
    }));
  }

  // Global elements (title, legend) — rendered via factory-created renderers
  for (const gid of ['__title__', '__legend__']) {
    const l = layout.nodes[gid];
    if (!l) continue;
    const r = renderers.get(gid);
    if (r) cells.push(...r.render({ x: l.x, y: l.y, width: l.width, height: l.height }));
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
const EDGE_SNAP_PX = 10;

function computePortEdgeSides(
  points: { x: number; y: number }[],
  edge: any,
  layout: any,
): { exitX: number | null; entryX: number | null } {
  let exitX: number | null = null;
  let entryX: number | null = null;

  const srcNode = layout.nodes[edge.from];
  if (srcNode) {
    const sp = points[0];
    const distLeft = Math.abs(sp.x - srcNode.x);
    const distRight = Math.abs(sp.x - (srcNode.x + srcNode.width));
    if (distLeft <= EDGE_SNAP_PX) exitX = 0;
    else if (distRight <= EDGE_SNAP_PX) exitX = 1;
    // else: endpoint is in the interior — don't constrain
  }

  const tgtNode = layout.nodes[edge.to];
  if (tgtNode) {
    const ep = points[points.length - 1];
    const distLeft = Math.abs(ep.x - tgtNode.x);
    const distRight = Math.abs(ep.x - (tgtNode.x + tgtNode.width));
    if (distLeft <= EDGE_SNAP_PX) entryX = 0;
    else if (distRight <= EDGE_SNAP_PX) entryX = 1;
  }

  return { exitX, entryX };
}
