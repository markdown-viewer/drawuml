import { escapeXml, mxVertex, wrapMxfile, cellId, n4, PAGE_WIDTH, PAGE_HEIGHT } from '../shared/xml-utils.ts';
import { buildEdgeCells } from '../shared/edge-builder.ts';
import { Renderer } from '../primitives/renderer.ts';
import {
  getScaledParticipantConfig,
  participantCellGeom,
  participantStyle,
  renderParticipant,
  renderFootbox,
} from '../primitives/participant.ts';
import { messageStyle } from '../primitives/message.ts';
import { renderDestroyMarker, renderActivationBar } from '../primitives/activation.ts';
import { renderFragment } from '../primitives/fragment.ts';
import { renderDivider } from '../primitives/divider.ts';
import { renderDurationConstraint } from '../primitives/duration-constraint.ts';
import { createTheme, type Theme } from '../shared/theme.ts';
import { closeUnclosedTags } from '../shared/text-block.ts';

export function sequenceToDrawioXml(model, layout, renderers?: Map<string, Renderer>, theme: Theme = createTheme()) {
  const cells = [];
  cells.push('<mxCell id="0"/>');
  cells.push('<mxCell id="1" parent="0"/>');

  // Title
  if (layout.title) {
    const r = renderers?.get('diagram-title');
    if (r) cells.push(...r.render(layout.title));
  }

  // Mainframe: umlFrame wrapping the entire diagram
  if (layout.mainframe) {
    const r = renderers?.get('mainframe');
    if (r) cells.push(...r.render(layout.mainframe));
  }

  // Boxes: participant group backgrounds
  for (const box of layout.boxes || []) {
    const r = renderers?.get(box.id);
    if (r) cells.push(...r.render(box));
  }

  // Fragments (rendered before participants so lifelines appear on top of frame fills)
  for (const frag of layout.fragments || []) {
    cells.push(...renderFragment({ ...frag, theme }));
  }

  // Participants
  for (const p of model.participants) {
    const lp = layout.participants[p.id];
    if (!lp) continue;
    cells.push(...renderParticipant(p, lp, { stereotypePosition: model.stereotypePosition, participantAlign: model.participantAlign, actorStyle: model.actorStyle, theme }));

    // Destroy marker (X cross) at the destroy row position on the lifeline
    if (lp.isDestroyed && lp.destroyY != null) {
      cells.push(renderDestroyMarker(p.id + '_destroy', lp.centerX, lp.destroyY, undefined, undefined, theme));
    }
  }

  // Footbox: bottom participant boxes (default visible, hidden by "hide footbox")
  if (!model.hideFootbox) {
    for (const p of model.participants) {
      const lp = layout.participants[p.id];
      if (!lp) continue;
      cells.push(...renderFootbox(p, lp, { stereotypePosition: model.stereotypePosition, participantAlign: model.participantAlign, actorStyle: model.actorStyle, theme }));
    }
  }

  // Build participant cell geometry map for activation bar relative positioning
  const participantCellMap: Record<string, { cellX: number; cellY: number }> = {};
  for (const p of model.participants) {
    const lp = layout.participants[p.id];
    if (!lp) continue;
    const { cellX } = participantCellGeom(p.type, lp.x, lp.width, theme.sizeM);
    participantCellMap[p.id] = { cellX, cellY: lp.y };
  }

  // Activation bars — sort by depth ascending so nested bars render on top
  const sortedActs = [...(layout.activations || [])].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  for (const act of sortedActs) {
    const pc = participantCellMap[act.participant];
    cells.push(...renderActivationBar(act, pc ? { x: pc.cellX, y: pc.cellY } : undefined, theme));
  }

  // Dividers
  for (const divider of layout.dividers || []) {
    cells.push(...renderDivider({ ...divider, theme }));
  }

  // Duration constraints (teoz {tag} <-> {tag} : label)
  for (const dc of layout.durationConstraints || []) {
    cells.push(...renderDurationConstraint({ ...dc, theme }));
  }

  // Notes
  for (const note of layout.notes || []) {
    // Bind note to lifeline as child when it has a single parent participant
    const pc = note.parentId ? participantCellMap[note.parentId] : null;
    const r = renderers?.get(note.id);
    if (r) {
      let nx = note.x;
      let ny = note.y;
      if (pc) {
        nx = note.x - pc.cellX;
        ny = note.y - pc.cellY;
      }
      const noteCells = r.render({ x: nx, y: ny, width: note.width, height: note.height });
      if (pc) {
        // Re-parent root cell to the lifeline participant
        cells.push(noteCells[0].replace(' parent="1"', ` parent="${escapeXml(cellId(note.parentId!))}"`));
        for (let ci = 1; ci < noteCells.length; ci++) cells.push(noteCells[ci]);
      } else {
        cells.push(...noteCells);
      }
    }
  }

  // Build activation id → layout map for exit/entry Y computation on activation-connected edges
  const actLayoutMap = new Map<string, { y: number; height: number }>();
  for (const act of layout.activations || []) {
    actLayoutMap.set(act.id, act);
  }

  // Build participant layout map for lifeline-connected edges (no activation)
  const pConfig = getScaledParticipantConfig(theme.sizeM);
  const pLayoutMap: Record<string, { x: number; y: number; width: number; height: number; centerX: number }> = {};
  for (const p of model.participants) {
    const lp = layout.participants[p.id];
    if (!lp) continue;
    const cfg = pConfig[p.type] || pConfig.participant;
    const cellW = cfg.iconW > 0 ? cfg.iconW : lp.width;
    const cellX = lp.x + (lp.width - cellW) / 2;
    pLayoutMap[p.id] = { x: cellX, y: lp.y, width: cellW, height: lp.height, centerX: lp.centerX };
  }

  // Helper: check if an id refers to an external endpoint
  const isExternalId = (id: string) => id === '__external_left__' || id === '__external_right__';

  /**
   * Compute edge label geometry parameters for any message type.
   * Returns geoX, geoY, offsetX, vAlign, labelAlign used by the edge's
   * mxGeometry so that drawio2svg positions the label consistently.
   */
  function computeLabelGeo(msg: any) {
    const isLeftward = msg.fromX > msg.toX;
    const labelBelow = model.responseMessageBelowArrow && isLeftward;
    const vAlign = labelBelow ? 'top' : 'bottom';
    const isTimed = !msg.self && (msg.toY ?? msg.y) !== msg.y;
    const labelPad = theme.padXS;

    if (msg.self) {
      const dir = msg.arrowStyle?.direction || 'right';
      if (dir === 'left') {
        return { geoX: -1, geoY: -3, offsetX: -labelPad, vAlign, labelAlign: 'right' };
      }
      return { geoX: -1, geoY: 3, offsetX: labelPad, vAlign, labelAlign: 'left' };
    }

    if (isTimed) {
      const labelAlign = isLeftward ? 'right' : 'left';
      const geoY = isLeftward ? -3 : 3;
      const offsetX = isLeftward ? -labelPad : labelPad;
      return { geoX: -1, geoY, offsetX, vAlign, labelAlign };
    }

    // Normal horizontal messages: label starts from source end
    const geoX = isLeftward ? 1 : -1;
    const geoY = isLeftward ? -3 : 3;
    return { geoX, geoY, offsetX: labelPad, vAlign, labelAlign: 'left' };
  }

  // Messages
  for (const msg of layout.messages || []) {
    const prefix = msg.numberPrefix || '';
    const label = msg.label || '';
    // Combine prefix and label — both are raw Creole text.
    // Close unclosed HTML tags in prefix so styles don't leak into label.
    const closedPrefix = prefix ? closeUnclosedTags(prefix) : '';
    const displayLabel = closedPrefix ? (label ? closedPrefix + ' ' + label : closedPrefix) : label;

    // Override exitX/exitY/entryX/entryY when connected to activation boxes.
    // exitX/entryX: use edge direction to connect to left/right edge (not center).
    // exitY/entryY: use position relative to activation box height.
    // Skip for self-ref messages — they handle exit/entry separately.
    const msgForStyle = (!msg.self && (msg.sourceActId || msg.targetActId)) ? { ...msg } : msg;
    const goingLeft = msg.fromX > msg.toX;
    if (!msg.self && msg.sourceActId) {
      const act = actLayoutMap.get(msg.sourceActId);
      if (act) {
        msgForStyle.fromRelY = Math.max(0, Math.min(1, (msg.y - act.y) / Math.max(act.height, 1)));
      }
      // exitX: right edge (1.0) for rightward, left edge (0.0) for leftward
      msgForStyle.exitX = goingLeft ? 0.0 : 1.0;
    }
    if (!msg.self && msg.targetActId) {
      const act = actLayoutMap.get(msg.targetActId);
      if (act) {
        const y = msg.toY ?? msg.y;
        msgForStyle.toRelY = Math.max(0, Math.min(1, (y - act.y) / Math.max(act.height, 1)));
      }
      // When the message arrives at the bottom of the activation (activation ends here),
      // point to center to indicate termination; otherwise point to the near edge.
      if (msgForStyle.toRelY >= 0.99) {
        msgForStyle.entryX = 0.5;
      } else {
        msgForStyle.entryX = goingLeft ? 1.0 : 0.0;
      }
    }

    let style = messageStyle(msgForStyle, theme.strokeWidth);

    if (msg.self) {
      // Self-reference: 3-segment path using sourcePoint + waypoints + targetPoint.
      // Connect to activation boxes via source/target when available, so edges
      // follow when activation bars are dragged in drawio.

      // Build source/target ids and style additions for self-ref
      let selfSource: string | undefined;
      let selfTarget: string | undefined;
      let selfStyleExtra = '';
      if (msg.sourceActId) {
        selfSource = msg.sourceActId;
        const dir = msg.waypoints?.length ? (msg.waypoints[0].x > msg.fromX ? 1.0 : 0.0) : 1.0;
        const srcAct = actLayoutMap.get(msg.sourceActId);
        if (srcAct) {
          const relY = Math.max(0, Math.min(1, (msg.y - srcAct.y) / Math.max(srcAct.height, 1)));
          selfStyleExtra += `exitX=${n4(dir)};exitY=${n4(relY)};exitPerimeter=0;`;
        }
      } else if (pLayoutMap[msg.from]) {
        selfSource = msg.from;
        selfStyleExtra += `exitX=0.5;exitY=${n4(msg.fromRelY)};exitPerimeter=0;`;
      }
      if (msg.targetActId) {
        selfTarget = msg.targetActId;
        const dir = msg.waypoints?.length ? (msg.waypoints[0].x > msg.toX ? 1.0 : 0.0) : 1.0;
        const tgtAct = actLayoutMap.get(msg.targetActId);
        if (tgtAct) {
          const relY = Math.max(0, Math.min(1, (msg.toY - tgtAct.y) / Math.max(tgtAct.height, 1)));
          selfStyleExtra += `entryX=${n4(dir)};entryY=${n4(relY)};entryPerimeter=0;`;
        }
      } else if (pLayoutMap[msg.from]) {
        selfTarget = msg.from;
        const pl = pLayoutMap[msg.from];
        const entryRelY = Math.max(0, Math.min(1, (msg.toY - pl.y) / Math.max(pl.height, 1)));
        selfStyleExtra += `entryX=0.5;entryY=${n4(entryRelY)};entryPerimeter=0;`;
      }

      // Merge self-ref extra style into the edge style,
      // stripping default exit/entry constraints from messageStyle() to avoid duplicates
      const baseStyle = style.replace(/exit[XY]=[^;]+;/g, '').replace(/entry[XY]=[^;]+;/g, '');
      const geo = computeLabelGeo(msg);
      let selfFinalStyle = selfStyleExtra ? baseStyle + selfStyleExtra : style;
      selfFinalStyle += `verticalAlign=${geo.vAlign};align=${geo.labelAlign};`;

      const wp = msg.waypoints || [];

      cells.push(...buildEdgeCells({
        id: msg.id,
        label: displayLabel || undefined,
        style: selfFinalStyle,
        source: selfSource,
        target: selfTarget,
        geometry: {
          x: geo.geoX,
          y: geo.geoY,
          offset: { x: geo.offsetX, y: 0 },
          sourcePoint: { x: msg.fromX, y: msg.y },
          targetPoint: { x: msg.toX, y: msg.toY },
          waypoints: wp,
        },
        fontSize: theme.fontSize,
        fontFamily: theme.fontFamily,
      }));
      continue;
    }

    // Normal messages: pin label to source (rightward) or target (leftward).
    // verticalAlign=bottom ensures multi-line labels grow upward from the arrow.
    const geo = computeLabelGeo(msg);

    // Timed (slanted) messages: label anchored at source (higher endpoint)
    // with align matching the side: left-aligned for rightward, right-aligned for leftward.
    const isTimed = (msg.toY ?? msg.y) !== msg.y;
    const timedAlignStyle = isTimed ? `align=${geo.labelAlign};` : '';
    let finalStyle = style + `verticalAlign=${geo.vAlign};${timedAlignStyle}`;

    // Build source/target ids for edge binding.
    // Priority: activation box > lifeline participant > none (external).
    let sourceId: string | undefined;
    let targetId: string | undefined;
    if (msg.sourceActId) {
      sourceId = msg.sourceActId;
      finalStyle += 'exitPerimeter=0;';
    } else if (!isExternalId(msg.from) && pLayoutMap[msg.from]) {
      sourceId = msg.from;
      finalStyle += 'exitPerimeter=0;';
    }
    if (msg.targetActId) {
      targetId = msg.targetActId;
      finalStyle += 'entryPerimeter=0;';
    } else if (!msg.isCreate && !isExternalId(msg.to) && pLayoutMap[msg.to]) {
      targetId = msg.to;
      finalStyle += 'entryPerimeter=0;';
    }

    cells.push(...buildEdgeCells({
      id: msg.id,
      label: displayLabel || undefined,
      style: finalStyle,
      source: sourceId,
      target: targetId,
      geometry: {
        x: geo.geoX,
        y: geo.geoY,
        offset: { x: geo.offsetX, y: 0 },
        sourcePoint: { x: msg.fromX, y: msg.y },
        targetPoint: { x: msg.toX, y: msg.toY ?? msg.y },
      },
      fontSize: theme.fontSize,
      fontFamily: theme.fontFamily,
    }));
  }

  return wrapMxfile(cells, {
    pageWidth: Math.max(PAGE_WIDTH, Math.ceil(layout.width)),
    pageHeight: Math.max(PAGE_HEIGHT, Math.ceil(layout.height)),
    diagramName: 'Sequence Diagram',
  });
}
