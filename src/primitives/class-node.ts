/**
 * Class node primitive — sizing, styling, and rendering for UML class swimlane nodes.
 * Shared between dot-layout.ts (sizing) and drawio-gen.ts (rendering).
 *
 * Content processing is delegated to the shared Content module.
 * This file provides:
 *   - classContent(node) — create a Content object for a class node
 *   - classNodeStyle(node, startSize) — generate DrawIO swimlane style
 *   - textRowStyle / separatorStyle — generate DrawIO child row/separator styles
 */

import { Content, CLASS_ROW_HEIGHT, CLASS_SEPARATOR_HEIGHT, CLASS_BODY_PADDING_Y, TITLED_SEPARATOR_HEIGHT } from '../shared/content.ts';
import { buildLabelHtml } from './label.ts';
import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import { SwimlaneRenderer } from './renderer.ts';
import { CLASS_FILL, DEFAULT_FONT_SIZE } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor, NodeDescriptor } from './registry.ts';
import type { ContentBox, FinalizeBodyCtx } from '../shared/content.ts';
import type { BodyLine } from '../model/class-model.ts';

// Re-export layout constants for consumers (e.g. DOT port-label building)
export { CLASS_ROW_HEIGHT as ROW_HEIGHT, CLASS_SEPARATOR_HEIGHT as SEPARATOR_HEIGHT } from '../shared/content.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_FONT_SIZE = DEFAULT_FONT_SIZE;   // container font size for title area

/** Spot character and background color per entity stereotype/type. */
const SPOT_MAP: Record<string, { char: string; color: string }> = {
  abstract:   { char: 'A', color: '#A9DCDF' },
  annotation: { char: '@', color: '#E3664A' },
  class:      { char: 'C', color: '#ADD1B2' },
  interface:  { char: 'I', color: '#B4A7E5' },
  enum:       { char: 'E', color: '#EB937F' },
  entity:     { char: 'E', color: '#ADD1B2' },
  'entity-class': { char: 'E', color: '#ADD1B2' },
  protocol:   { char: 'P', color: '#F1F1F1' },
  struct:     { char: 'S', color: '#F1F1F1' },
  exception:  { char: 'X', color: '#D94321' },
  metaclass:  { char: 'M', color: '#CCCCCC' },
  stereotype: { char: 'S', color: '#FF77FF' },
};

/** Types whose class name should be rendered in italic. */
const ITALIC_TYPES = new Set(['abstract', 'interface']);

/** Stereotypes that produce a spot circle. */
const SPOT_TYPES = new Set(Object.keys(SPOT_MAP));

// ---------------------------------------------------------------------------
// Title HTML (shared by sizing and rendering)
// ---------------------------------------------------------------------------

/**
 * Build HTML for the title area of a class node.
 * Delegates to shared buildLabelHtml with class-specific spot/italic resolution.
 */
export function buildTitleHtml(node: { label: string; stereotype?: string | null; type?: string; stereotypeLabel?: string; hideCircle?: boolean; spot?: { char: string; color: string } }): string {
  const stype = node.stereotype || node.type || '';
  // Custom spot from <<(X,color)>> overrides the default SPOT_MAP lookup.
  const spotInfo = node.hideCircle ? undefined : (node.spot || SPOT_MAP[stype]);
  // Convert raw Creole label to HTML inside the renderer
  const labelHtml = Content.inline(node.label).html;
  return buildLabelHtml({
    label: labelHtml,
    stereotypeLabel: node.stereotypeLabel,
    spot: spotInfo ? { char: spotInfo.char, color: spotInfo.color } : undefined,
    italic: ITALIC_TYPES.has(stype),
  });
}

// ---------------------------------------------------------------------------
// Content factory
// ---------------------------------------------------------------------------

/**
 * FinalizeBody callback for entities that skip auto-separator
 * (e.g. object, state). Returns emptyBodyPad for empty body.
 */
function skipAutoSeparator(ctx: FinalizeBodyCtx): Partial<Record<string, any>> {
  if (ctx.lines.length === 0) return { emptyBodyPad: 10 };
  return {};
}

/**
 * Create a Content object representing the FULL content of a class node.
 * The returned Content handles both measurement and rendering.
 */
export function classContent(node: {
  id: string;
  label: string;
  stereotype?: string | null;
  type?: string;
  stereotypeLabel?: string;
  bodyLines?: BodyLine[];
  visibilityIcons?: boolean;
  hideCircle?: boolean;
  hideFields?: boolean;
  hideMethods?: boolean;
  spot?: { char: string; color: string };
}): Content {
  const entityType = node.stereotype || node.type || '';
  const skipAutoSep = entityType === 'object';
  return Content.classBody({
    titleHtml: buildTitleHtml(node),
    nodeId: node.id,
    bodyLines: node.bodyLines,
    visibilityIcons: node.visibilityIcons,
    hideFields: node.hideFields,
    hideMethods: node.hideMethods,
    finalizeBody: skipAutoSep ? skipAutoSeparator : undefined,
  });
}

// ---------------------------------------------------------------------------
// Sizing (backward-compatible wrappers)
// ---------------------------------------------------------------------------

/** Compute title bar height for a class node. */
export function computeTitleH(node: { label: string; stereotype?: string | null; type?: string; stereotypeLabel?: string; hideCircle?: boolean }): number {
  return classContent({ id: '', ...node }).measure().titleHeight!;
}

// ---------------------------------------------------------------------------
// DrawIO styles
// ---------------------------------------------------------------------------

/** Generate swimlane style string for a class node mxCell. */
export function classNodeStyle(node: { stereotype?: string | null; type?: string; label: string; stereotypeLabel?: string; style?: string | null; hideCircle?: boolean }, startSize?: number): string {
  const stype = node.stereotype || node.type || '';
  const resolvedSize = startSize ?? computeTitleH(node);
  const parsed = parseNodeStyle(node.style);

  const base = [
    'swimlane',
    'html=1',
    'align=center',
    'verticalAlign=middle',
    'childLayout=stackLayout',
    'horizontal=1',
    `startSize=${resolvedSize}`,
    'horizontalStack=0',
    'resizeParent=1',
    'resizeLast=0',
    'collapsible=1',
    'marginBottom=0',
    'rounded=1',
    'absoluteArcSize=1',
    'arcSize=3',
    'shadow=0',
    'strokeWidth=1',
  ];

  if (ITALIC_TYPES.has(stype)) base.push('fontStyle=2');
  else base.push('fontStyle=0');

  // Apply parsed style colors
  if (parsed) {
    if (parsed.fillColor) {
      base.push(`fillColor=${parsed.fillColor}`);
      // Auto-derive stroke color when only fill is specified
      if (!parsed.strokeColor) base.push(`strokeColor=${darkenColor(parsed.fillColor)}`);
    }
    if (parsed.strokeColor) base.push(`strokeColor=${parsed.strokeColor}`);
    if (parsed.textColor) base.push(`fontColor=${parsed.textColor}`);
    if (parsed.lineStyle === 'dashed') base.push('dashed=1');
    else if (parsed.lineStyle === 'dotted') base.push('dashed=1', 'dashPattern=1 2');
    else if (parsed.lineStyle === 'bold') base.push('strokeWidth=2');
  }

  // Default white fill when no custom fill specified
  if (!base.some(s => s.startsWith('fillColor='))) {
    base.push(`fillColor=${CLASS_FILL}`);
  }

  return base.join(';') + ';';
}

/** Style string for attribute/method text rows inside a class swimlane. */
export function textRowStyle(strokeColor?: string, lineStyle?: string): string {
  const parts = [
    'text', 'html=1', 'strokeColor=none', 'fillColor=none',
    'align=left', 'verticalAlign=middle',
    'spacingLeft=4', 'spacingRight=4',
    'whiteSpace=wrap', 'overflow=hidden', 'rotatable=0',
    'points=[[0,0.5],[1,0.5]]', 'portConstraint=eastwest',
  ];
  if (strokeColor) parts.push(`strokeColor=${strokeColor}`);
  if (lineStyle === 'dashed') parts.push('dashed=1');
  else if (lineStyle === 'dotted') parts.push('dashed=1', 'dashPattern=1 2');
  else if (lineStyle === 'bold') parts.push('strokeWidth=2');
  return parts.join(';') + ';';
}

/** Style string for the separator line between attributes and methods. */
export function separatorStyle(strokeColor?: string, lineStyle?: string): string {
  const parts = [
    'line',
    'strokeWidth=1',
    'align=left',
    'verticalAlign=middle',
    'spacingTop=-1',
    'spacingLeft=3',
    'spacingRight=3',
    'rotatable=0',
    'labelPosition=right',
    'points=[]',
    'portConstraint=eastwest',
  ];
  if (strokeColor) parts.push(`strokeColor=${strokeColor}`);
  if (lineStyle === 'dashed') parts.push('dashed=1');
  else if (lineStyle === 'dotted') parts.push('dashed=1', 'dashPattern=1 2');
  else if (lineStyle === 'bold') parts.push('strokeWidth=2');
  return parts.join(';') + ';';
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class ClassNodeRenderer extends SwimlaneRenderer {
  private node: NodeDescriptor;
  private childStroke?: string;
  private childLineStyle?: string;
  private skipAutoSep: boolean;

  constructor(node: NodeDescriptor) {
    super(node.id);
    this.node = node;
    const entityType = node.stereotype || node.type || '';
    this.skipAutoSep = entityType === 'object';
    this.initContent(buildTitleHtml(node), {
      bodyLines: node.bodyLines,
      visibilityIcons: node.visibilityIcons,
      hideFields: node.hideFields,
      hideMethods: node.hideMethods,
    });
    const parsed = parseNodeStyle(node.style);
    this.childStroke = parsed?.strokeColor || undefined;
    this.childLineStyle = parsed?.lineStyle || undefined;
  }

  protected finalizeBody(ctx: FinalizeBodyCtx) {
    return this.skipAutoSep ? skipAutoSeparator(ctx) : null;
  }

  protected getContainerStyle(titleHeight: number) {
    return classNodeStyle(this.node, titleHeight);
  }

  protected getRowStyle() {
    return textRowStyle(this.childStroke, this.childLineStyle);
  }

  protected getSeparatorStyle() {
    return separatorStyle(this.childStroke, this.childLineStyle);
  }

  /**
   * Build an HTML-label for DOT with PORT attributes on each member row.
   * Enables viz.js to route edges directly to specific fields.
   */
  buildPortLabel(widthPx: number): string {
    const blocks = this.content.blocks;
    const measured = this.content.measure();
    const ROW_HEIGHT = CLASS_ROW_HEIGHT;
    const SEPARATOR_HEIGHT = CLASS_SEPARATOR_HEIGHT;
    const BODY_PAD = CLASS_BODY_PADDING_Y;

    const rows: string[] = [];
    let totalH = 0;
    let bodyStarted = false;

    for (const b of blocks) {
      if (b.kind === 'title') {
        const h = measured.titleHeight;
        rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${h}" WIDTH="${widthPx}"> </TD></TR>`);
        totalH += h;
      } else {
        // Insert body top-padding row before the first non-title block
        if (!bodyStarted && BODY_PAD > 0) {
          rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${BODY_PAD}" WIDTH="${widthPx}"> </TD></TR>`);
          totalH += BODY_PAD;
          bodyStarted = true;
        }

        if (b.kind === 'separator') {
          const sepH = b.title ? TITLED_SEPARATOR_HEIGHT : SEPARATOR_HEIGHT;
          rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${sepH}" WIDTH="${widthPx}"> </TD></TR>`);
          totalH += sepH;
        } else if (b.kind === 'row') {
          const rowContent = Content.text(b.html);
          const rowSize = rowContent.measure();
          const h = (rowSize.height || ROW_HEIGHT) + BODY_PAD;
          const portName = b.id ? b.id.split('::').slice(1).join('::') : '';
          // Escape special HTML chars in port name for DOT HTML labels
          const safePort = portName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          if (safePort) {
            rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${h}" WIDTH="${widthPx}" PORT="${safePort}"> </TD></TR>`);
          } else {
            rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${h}" WIDTH="${widthPx}"> </TD></TR>`);
          }
          totalH += h;
        } else if (b.kind === 'rich') {
          const richContent = Content.text(b.html);
          const richSize = richContent.measure();
          const h = richSize.height || ROW_HEIGHT;
          rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${h}" WIDTH="${widthPx}"> </TD></TR>`);
          totalH += h;
        }
      }
    }

    // Body bottom-padding row
    if (bodyStarted && BODY_PAD > 0) {
      rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${BODY_PAD}" WIDTH="${widthPx}"> </TD></TR>`);
      totalH += BODY_PAD;
    }

    return `<\n<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" FIXEDSIZE="TRUE" WIDTH="${widthPx}" HEIGHT="${totalH}">\n${rows.join('\n')}\n</TABLE>\n>`;
  }
}

/** Register class-node renderer into global registry. */
export function registerClassNodeRenderer(): void {
  const factory = (desc: RenderDescriptor) => new ClassNodeRenderer(desc as NodeDescriptor);
  registerRenderer('class', factory);
  // Class-like type aliases — all legitimately rendered by the swimlane renderer
  for (const alias of ['abstract', 'annotation', 'enum', 'exception', 'metaclass', 'protocol', 'stereotype', 'struct', 'object', 'interface', 'entity-class']) {
    registerRenderer(alias, factory);
  }
}

