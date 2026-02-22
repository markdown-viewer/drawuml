/**
 * Participant (lifeline) primitive — config, sizing, style & rendering.
 * Shared by table-layout.ts (sizing) and sequence-gen.ts (rendering).
 */

import { mxVertex } from '../shared/xml-utils.ts';
import { darkenColor } from '../shared/color-utils.ts';
import { Content, richTextStyle } from '../shared/content.ts';
import { buildLabelHtml } from './label.ts';
import { COLOR_DARK } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Participant type configuration
// ---------------------------------------------------------------------------

/** Icon size, geometry width, and label position per participant type. */
export const PARTICIPANT_CONFIG: Record<string, { participant: string; iconSize: number; iconW: number; textBelow: boolean }> = {
  participant:  { participant: '',               iconSize: 28, iconW: 0,  textBelow: false },
  actor:        { participant: 'umlActor',       iconSize: 40, iconW: 26, textBelow: true },
  boundary:     { participant: 'umlBoundary',    iconSize: 28, iconW: 34, textBelow: true },
  control:      { participant: 'umlControl',     iconSize: 28, iconW: 24, textBelow: true },
  entity:       { participant: 'umlEntity',      iconSize: 28, iconW: 28, textBelow: true },
  database:     { participant: 'umlDatabase',    iconSize: 28, iconW: 22, textBelow: true },
  collections:  { participant: 'umlCollections', iconSize: 28, iconW: 0,  textBelow: false },
  queue:        { participant: 'umlQueue',       iconSize: 28, iconW: 0,  textBelow: false },
};

/** Minimum icon widths for participant types with external labels (used by layout). */
export const ICON_MIN_WIDTH: Record<string, number> = {
  actor: 26,
  boundary: 34,
  control: 24,
  entity: 28,
  database: 22,
};

/** Icon heights per participant type (used by layout). */
export const ICON_HEIGHT: Record<string, number> = {
  actor: 40,
  boundary: 28,
  control: 28,
  entity: 28,
  database: 28,
  collections: 28,
  queue: 28,
  participant: 28,
};

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

/** Compute the DrawIO cell width and cell X for a participant lifeline. */
export function participantCellGeom(
  pType: string,
  layoutX: number,
  layoutWidth: number,
): { cellW: number; cellX: number } {
  const cfg = PARTICIPANT_CONFIG[pType] || PARTICIPANT_CONFIG.participant;
  const cellW = cfg.iconW > 0 ? cfg.iconW : layoutWidth;
  const cellX = layoutX + (layoutWidth - cellW) / 2;
  return { cellW, cellX };
}

/** Generate the DrawIO style for a umlLifeline participant cell. */
export function participantStyle(
  nodeType: string,
  opts: { isFootbox?: boolean; color?: string; iconHeight?: number; actorStyle?: string } = {},
): string {
  const cfg = PARTICIPANT_CONFIG[nodeType] || PARTICIPANT_CONFIG.participant;
  const size = opts.iconHeight || cfg.iconSize;

  const parts = [
    'shape=umlLifeline',
    'perimeter=lifelinePerimeter',
    'whiteSpace=wrap',
    'container=1',
    'collapsible=0',
    'recursiveResize=0',
    'outlineConnect=0',
    `size=${size}`,
    'rounded=1',
    'absoluteArcSize=1',
    'arcSize=3',
    'html=1',
  ];
  if (cfg.participant) parts.push(`participant=${cfg.participant}`);
  if (opts.actorStyle && cfg.participant === 'umlActor') {
    parts.push(`actorStyle=${opts.actorStyle}`);
  }
  if (opts.color) {
    // PlantUML #red → CSS 'red', #99FF99 → '#99FF99'
    const c = opts.color.startsWith('#') && !/^#[0-9a-fA-F]+$/.test(opts.color)
      ? opts.color.slice(1)
      : opts.color;
    parts.push(`fillColor=${c}`);
    // Auto-derive border color by darkening fill when no explicit border set
    parts.push(`strokeColor=${darkenColor(c)}`);
  }
  if (cfg.textBelow) {
    if (opts.isFootbox) {
      parts.push('verticalLabelPosition=bottom');
      parts.push('verticalAlign=top');
    } else {
      parts.push('verticalLabelPosition=top');
      parts.push('verticalAlign=bottom');
    }
  }
  return parts.join(';') + ';';
}

// ---------------------------------------------------------------------------
// Label building (delegates to shared buildLabelHtml)
// ---------------------------------------------------------------------------

/**
 * Build HTML label for a participant, including optional stereotype and spot.
 * Converts raw Creole label to HTML internally, then delegates to shared buildLabelHtml.
 */
export function buildParticipantLabel(
  p: { label: string; stereotypeLabel?: string; spot?: { char: string; color: string } },
  opts?: { stereotypePosition?: 'top' | 'bottom' },
): string {
  // Convert raw Creole label to HTML inside the renderer
  const labelHtml = Content.inline(p.label).html;
  return buildLabelHtml({
    label: labelHtml,
    stereotypeLabel: p.stereotypeLabel,
    spot: p.spot,
    stereotypePosition: opts?.stereotypePosition,
  });
}

// ---------------------------------------------------------------------------
// Bracket body child cell styles
// ---------------------------------------------------------------------------

/** Style string for rich text blocks inside a bracket body participant. */
function bracketTextStyle(align: 'left' | 'center' | 'right' = 'center'): string {
  return richTextStyle(10, 10, align);
}

/** Style string for separator lines inside a bracket body participant. */
function bracketSepStyle(): string {
  return [
    'line', 'strokeWidth=1', 'align=left', 'verticalAlign=middle',
    'spacingTop=-1', 'spacingLeft=3', 'spacingRight=3',
    'rotatable=0', 'labelPosition=right', 'points=[]',
  ].join(';') + ';';
}

// ---------------------------------------------------------------------------
// Bracket body measurement (used by table-layout)
// ---------------------------------------------------------------------------

/**
 * Measure bracket body content dimensions for a participant with bracketLines.
 * Returns { width, height } of the rich body content.
 */
export function measureBracketBody(bracketLines: string[]): { width: number; height: number } {
  return Content.bracketBody(bracketLines).measure();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a participant lifeline (header) to DrawIO mxCell XML strings.
 * Returns an array: for bracket participants, includes container + child cells.
 */
export function renderParticipant(
  p: { id: string; label: string; type: string; color?: string; bracketLines?: string[]; stereotypeLabel?: string; spot?: { char: string; color: string } },
  layout: { x: number; y: number; width: number; height: number; iconHeight?: number },
  opts?: { stereotypePosition?: 'top' | 'bottom'; participantAlign?: 'left' | 'center' | 'right'; actorStyle?: string },
): string[] {
  const { cellW, cellX } = participantCellGeom(p.type, layout.x, layout.width);

  if (p.bracketLines && p.bracketLines.length > 0) {
    // Bracket body participant: container + rich content children
    const content = Content.bracketBody(p.bracketLines);
    const cells: string[] = [];
    const containerStyleStr = participantStyle(p.type, { color: p.color, iconHeight: layout.iconHeight, actorStyle: opts?.actorStyle });
    const fillColor = containerStyleStr.match(/fillColor=([^;]*)/)?.[1] || '#E2E2E2';
    const strokeColor = containerStyleStr.match(/strokeColor=([^;]*)/)?.[1] || COLOR_DARK;
    cells.push(mxVertex({
      id: p.id, value: '',
      style: containerStyleStr,
      parent: '1',
      x: cellX, y: layout.y, width: cellW, height: layout.height,
    }));
    if (content.hasSeparators) {
      cells.push(...content.renderChildren(p.id, cellW, {
        rowStyle: bracketTextStyle(opts?.participantAlign),
        separatorStyle: bracketSepStyle(),
        fillColor,
        strokeColor,
      }));
    } else {
      cells.push(mxVertex({
        value: content.html,
        style: bracketTextStyle(opts?.participantAlign),
        parent: p.id,
        y: 0, width: cellW, height: layout.iconHeight || 28,
      }));
    }
    return cells;
  }

  const labelHtml = buildParticipantLabel(p, opts);
  return [mxVertex({
    id: p.id, value: labelHtml,
    style: participantStyle(p.type, { color: p.color, iconHeight: layout.iconHeight, actorStyle: opts?.actorStyle }),
    parent: '1',
    x: cellX, y: layout.y, width: cellW, height: layout.height,
  })];
}

/**
 * Render a footbox (bottom participant) to DrawIO mxCell XML strings.
 * Returns an array: for bracket participants, includes container + child cells.
 */
export function renderFootbox(
  p: { id: string; label: string; type: string; color?: string; bracketLines?: string[]; stereotypeLabel?: string; spot?: { char: string; color: string } },
  layout: { x: number; y: number; width: number; height: number; iconHeight?: number },
  opts?: { stereotypePosition?: 'top' | 'bottom'; participantAlign?: 'left' | 'center' | 'right'; actorStyle?: string },
): string[] {
  const cfg = PARTICIPANT_CONFIG[p.type] || PARTICIPANT_CONFIG.participant;
  const footY = layout.y + layout.height;
  const footW = cfg.iconW > 0 ? cfg.iconW : layout.width;
  const footX = layout.x + (layout.width - footW) / 2;
  const footH = layout.iconHeight || cfg.iconSize;

  if (p.bracketLines && p.bracketLines.length > 0) {
    const content = Content.bracketBody(p.bracketLines);
    const footId = p.id + '_foot';
    const cells: string[] = [];
    const footStyleStr = participantStyle(p.type, { isFootbox: true, color: p.color, iconHeight: footH, actorStyle: opts?.actorStyle });
    const fillColor = footStyleStr.match(/fillColor=([^;]*)/)?.[1] || '#E2E2E2';
    const strokeColor = footStyleStr.match(/strokeColor=([^;]*)/)?.[1] || COLOR_DARK;
    cells.push(mxVertex({
      id: footId, value: '',
      style: footStyleStr,
      parent: '1',
      x: footX, y: footY, width: footW, height: footH,
    }));
    if (content.hasSeparators) {
      cells.push(...content.renderChildren(footId, footW, {
        rowStyle: bracketTextStyle(opts?.participantAlign),
        separatorStyle: bracketSepStyle(),
        fillColor,
        strokeColor,
      }));
    } else {
      cells.push(mxVertex({
        value: content.html,
        style: bracketTextStyle(opts?.participantAlign),
        parent: footId,
        y: 0, width: footW, height: footH,
      }));
    }
    return cells;
  }

  const labelHtml = buildParticipantLabel(p, opts);
  return [mxVertex({
    id: p.id + '_foot', value: labelHtml,
    style: participantStyle(p.type, { isFootbox: true, color: p.color, iconHeight: footH, actorStyle: opts?.actorStyle }),
    parent: '1',
    x: footX, y: footY, width: footW, height: footH,
  })];
}
