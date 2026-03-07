/**
 * Participant (lifeline) primitive — config, sizing, style & rendering.
 * Shared by table-layout.ts (sizing) and sequence-gen.ts (rendering).
 */

import { mxVertex, n4 } from '../shared/xml-utils.ts';
import { darkenColor } from '../shared/color-utils.ts';
import { BlockLayout, richTextStyle } from '../shared/block-layout.ts';
import { TextBlock, DEFAULT_FONT } from '../shared/text-block.ts';
import { buildLabelHtml } from './label.ts';
import { createTheme, type Theme } from '../shared/theme.ts';

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

/**
 * Compute PARTICIPANT_CONFIG scaled to a given iconSize (theme.sizeM).
 * Uses the same base aspect ratios as IconRenderer subclasses so that
 * lifeline icon dimensions stay consistent with standalone icon nodes.
 *
 * Base ratios (matching uml-shape.ts / actor.ts IconRenderer definitions):
 *   actor:    30 × 40   (scale = iconSize / min = iconSize / 30)
 *   boundary: 36 × 30   (scale = iconSize / 30)
 *   control:  30 × 35   (scale = iconSize / 30)
 *   entity:   30 × 30   (scale = iconSize / 30)
 *   database: 22 × 28   (square-like, scale = iconSize / 22)
 *   participant / collections / queue: iconSize × iconSize (box types)
 */
export function getScaledParticipantConfig(iconSize: number): Record<string, { participant: string; iconSize: number; iconW: number; textBelow: boolean }> {
  function scaled(baseW: number, baseH: number): { w: number; h: number } {
    const s = iconSize / Math.min(baseW, baseH);
    return { w: baseW * s, h: baseH * s };
  }
  const actor = scaled(30, 40);
  const boundary = scaled(36, 30);
  const control = scaled(30, 35);
  const entity = scaled(30, 30);
  const database = scaled(22, 28);
  const boxH = iconSize * 28 / 24; // proportional box height

  return {
    participant:  { participant: '',               iconSize: boxH,       iconW: 0,           textBelow: false },
    actor:        { participant: 'umlActor',       iconSize: actor.h,    iconW: actor.w,     textBelow: true },
    boundary:     { participant: 'umlBoundary',    iconSize: boundary.h, iconW: boundary.w,  textBelow: true },
    control:      { participant: 'umlControl',     iconSize: control.h,  iconW: control.w,   textBelow: true },
    entity:       { participant: 'umlEntity',      iconSize: entity.h,   iconW: entity.w,    textBelow: true },
    database:     { participant: 'umlDatabase',    iconSize: database.h, iconW: database.w,  textBelow: true },
    collections:  { participant: 'umlCollections', iconSize: boxH,       iconW: 0,           textBelow: false },
    queue:        { participant: 'umlQueue',       iconSize: boxH,       iconW: 0,           textBelow: false },
  };
}

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
  iconSize?: number,
): { cellW: number; cellX: number } {
  const cfg = iconSize ? (getScaledParticipantConfig(iconSize)[pType] || getScaledParticipantConfig(iconSize).participant) : (PARTICIPANT_CONFIG[pType] || PARTICIPANT_CONFIG.participant);
  const cellW = cfg.iconW > 0 ? cfg.iconW : layoutWidth;
  const cellX = layoutX + (layoutWidth - cellW) / 2;
  return { cellW, cellX };
}

/** Generate the DrawIO style for a umlLifeline participant cell. */
export function participantStyle(
  nodeType: string,
  opts: { isFootbox?: boolean; color?: string; iconHeight?: number; actorStyle?: string; fontSize?: number; fontFamily?: string; arcSize?: number; strokeWidth?: number } = {},
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
    `size=${n4(size)}`,
    'rounded=1',
    'absoluteArcSize=1',
    `arcSize=${opts.arcSize ?? 4}`,
    'html=1',
  ];
  if (opts.strokeWidth != null) parts.push(`strokeWidth=${opts.strokeWidth}`);
  if (opts.fontSize) parts.push(`fontSize=${opts.fontSize}`);
  if (opts.fontFamily) parts.push(`fontFamily=${opts.fontFamily}`);
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
  opts?: { stereotypePosition?: 'top' | 'bottom'; fontSize?: number; spotSize?: number; spotFontSize?: number; spotMargin?: number },
): string {
  // Convert raw Creole label to HTML inside the renderer
  const labelHtml = TextBlock.inline(p.label, DEFAULT_FONT).html;
  return buildLabelHtml({
    label: labelHtml,
    stereotypeLabel: p.stereotypeLabel,
    spot: p.spot,
    stereotypePosition: opts?.stereotypePosition,
    fontSize: opts?.fontSize,
    spotSize: opts?.spotSize,
    spotFontSize: opts?.spotFontSize,
    spotMargin: opts?.spotMargin,
  });
}

// ---------------------------------------------------------------------------
// Bracket body child cell styles
// ---------------------------------------------------------------------------

/** Style string for rich text blocks inside a bracket body participant. */
function bracketTextStyle(align: 'left' | 'center' | 'right' = 'center', fontSize?: number, fontFamily?: string, spacingX?: number): string {
  const sx = spacingX ?? 10;
  return richTextStyle(sx, sx, align, fontSize, fontFamily);
}



// ---------------------------------------------------------------------------
// Bracket body measurement (used by table-layout)
// ---------------------------------------------------------------------------

/**
 * Measure bracket body content dimensions for a participant with bracketLines.
 * Returns { width, height } of the rich body content.
 *
 * Algorithm copied from RichRenderer.doMeasure (hasRichBody branch):
 *   contentRect = content.measure() + contentPad*2 + strokeWidth*2
 * Participant has no shapePadding/titlebar, so final size = contentRect.
 */
export function measureBracketBody(bracketLines: string[], bodyFontSize?: number, fontFamily?: string, theme: Theme = createTheme()): { width: number; height: number } {
  const metrics: Partial<any> = {};
  if (bodyFontSize != null) metrics.bodyFontSize = bodyFontSize;
  if (fontFamily != null) metrics.fontFamily = fontFamily;
  const size = BlockLayout.bracketBody(bracketLines, Object.keys(metrics).length ? metrics : undefined, theme).measure();
  const contentPad = theme.padXS;
  const sw = theme.strokeWidth;
  return {
    width: size.width + contentPad * 2 + sw * 2,
    height: size.height + contentPad * 2 + sw * 2,
  };
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
  opts?: { stereotypePosition?: 'top' | 'bottom'; participantAlign?: 'left' | 'center' | 'right'; actorStyle?: string; theme?: Theme },
): string[] {
  const theme = opts?.theme ?? createTheme();
  const { cellW, cellX } = participantCellGeom(p.type, layout.x, layout.width, theme.sizeM);

  if (p.bracketLines && p.bracketLines.length > 0) {
    // Bracket body participant: container + rich content children
    const bracketMetrics: Partial<any> = {};
    if (theme.fontSize != null) bracketMetrics.bodyFontSize = theme.fontSize;
    if (theme.fontFamily != null) bracketMetrics.fontFamily = theme.fontFamily;
    const content = BlockLayout.bracketBody(p.bracketLines, Object.keys(bracketMetrics).length ? bracketMetrics : undefined, theme);
    const cells: string[] = [];
    const containerStyleStr = participantStyle(p.type, { color: p.color, iconHeight: layout.iconHeight, actorStyle: opts?.actorStyle, fontSize: theme.fontSize, fontFamily: theme.fontFamily, arcSize: theme.arcSize, strokeWidth: theme.strokeWidth });
    const colorDark = theme.colorDark;
    const fillColor = containerStyleStr.match(/fillColor=([^;]*)/)?.[1] || '#E2E2E2';
    const strokeColor = containerStyleStr.match(/strokeColor=([^;]*)/)?.[1] || colorDark;
    cells.push(mxVertex({
      id: p.id, value: '',
      style: containerStyleStr,
      parent: '1',
      x: cellX, y: layout.y, width: cellW, height: layout.height,
    }));
    // Content area algorithm copied from RichRenderer.renderRichBody:
    // childStartY = titlebarH + contentPad + padTop
    // Participant has no titlebar/shapePadding, so startY = contentPad.
    const contentPad = theme.padXS;
    if (content.hasSeparators) {
      cells.push(...content.renderChildren(p.id, cellW, {
        align: opts?.participantAlign,
        spacingX: theme.padXS,
        fillColor,
        strokeColor,
      }, contentPad));
    } else {
      cells.push(mxVertex({
        value: content.html,
        style: bracketTextStyle(opts?.participantAlign, theme.fontSize, theme.fontFamily, theme.padXS),
        parent: p.id,
        y: 0, width: cellW, height: layout.iconHeight || 28,
      }));
    }
    return cells;
  }

  const labelHtml = buildParticipantLabel(p, { ...opts, fontSize: theme.fontSize, spotSize: theme.sizeS, spotFontSize: theme.spotFontSize, spotMargin: theme.padXS });
  return [mxVertex({
    id: p.id, value: labelHtml,
    style: participantStyle(p.type, { color: p.color, iconHeight: layout.iconHeight, actorStyle: opts?.actorStyle, fontSize: theme.fontSize, fontFamily: theme.fontFamily, arcSize: theme.arcSize, strokeWidth: theme.strokeWidth }),
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
  opts?: { stereotypePosition?: 'top' | 'bottom'; participantAlign?: 'left' | 'center' | 'right'; actorStyle?: string; theme?: Theme },
): string[] {
  const theme = opts?.theme ?? createTheme();
  const pCfg = getScaledParticipantConfig(theme.sizeM);
  const cfg = pCfg[p.type] || pCfg.participant;
  const footY = layout.y + layout.height;
  const footW = cfg.iconW > 0 ? cfg.iconW : layout.width;
  const footX = layout.x + (layout.width - footW) / 2;
  const footH = layout.iconHeight || cfg.iconSize;

  if (p.bracketLines && p.bracketLines.length > 0) {
    const bracketMetrics: Partial<any> = {};
    if (theme.fontSize != null) bracketMetrics.bodyFontSize = theme.fontSize;
    if (theme.fontFamily != null) bracketMetrics.fontFamily = theme.fontFamily;
    const content = BlockLayout.bracketBody(p.bracketLines, Object.keys(bracketMetrics).length ? bracketMetrics : undefined, theme);
    const footId = p.id + '_foot';
    const cells: string[] = [];
    const footStyleStr = participantStyle(p.type, { isFootbox: true, color: p.color, iconHeight: footH, actorStyle: opts?.actorStyle, fontSize: theme.fontSize, fontFamily: theme.fontFamily, arcSize: theme.arcSize, strokeWidth: theme.strokeWidth });
    const colorDark = theme.colorDark;
    const fillColor = footStyleStr.match(/fillColor=([^;]*)/)?.[1] || '#E2E2E2';
    const strokeColor = footStyleStr.match(/strokeColor=([^;]*)/)?.[1] || colorDark;
    cells.push(mxVertex({
      id: footId, value: '',
      style: footStyleStr,
      parent: '1',
      x: footX, y: footY, width: footW, height: footH,
    }));
    const contentPad = theme.padXS;
    if (content.hasSeparators) {
      cells.push(...content.renderChildren(footId, footW, {
        align: opts?.participantAlign,
        spacingX: theme.padXS,
        fillColor,
        strokeColor,
      }, contentPad));
    } else {
      cells.push(mxVertex({
        value: content.html,
        style: bracketTextStyle(opts?.participantAlign, theme.fontSize, theme.fontFamily, theme.padXS),
        parent: footId,
        y: 0, width: footW, height: footH,
      }));
    }
    return cells;
  }

  const labelHtml = buildParticipantLabel(p, { ...opts, fontSize: theme.fontSize, spotSize: theme.sizeS, spotFontSize: theme.spotFontSize, spotMargin: theme.padXS });
  return [mxVertex({
    id: p.id + '_foot', value: labelHtml,
    style: participantStyle(p.type, { isFootbox: true, color: p.color, iconHeight: footH, actorStyle: opts?.actorStyle, fontSize: theme.fontSize, fontFamily: theme.fontFamily, arcSize: theme.arcSize, strokeWidth: theme.strokeWidth }),
    parent: '1',
    x: footX, y: footY, width: footW, height: footH,
  })];
}
