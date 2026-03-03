/**
 * Class node primitive — sizing, styling, and rendering for UML class swimlane nodes.
 * Shared between dot-layout.ts (sizing) and drawio-gen.ts (rendering).
 *
 * Content processing is delegated to the shared Content module.
 * This file provides:
 *   - classContent(node) — create a Content object for a class node
 *   - classNodeStyle(node, startSize) — generate DrawIO swimlane style
 */

import { Content } from '../shared/content.ts';
import { buildLabelHtml } from './label.ts';
import { parseNodeStyle, darkenColor } from '../shared/color-utils.ts';
import { SwimlaneRenderer } from './renderer.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor, NodeDescriptor } from './registry.ts';
import type { ContentBox, FinalizeBodyCtx } from '../shared/content.ts';
import type { BodyLine } from '../model/class-model.ts';
import type { LayoutGraphNode } from '../layout/layout-graph.ts';
import type { Theme } from '../shared/theme.ts';

// Re-export layout constants for consumers (e.g. DOT port-label building)


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
export function buildTitleHtml(node: { label: string; stereotype?: string | null; type?: string; stereotypeLabel?: string; hideCircle?: boolean; spot?: { char: string; color: string }; theme?: { fontSize: number; fontFamily: string; spotSize?: number; spotFontSize?: number; spotMargin?: number } }): string {
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
    fontSize: node.theme?.fontSize,
    spotSize: node.theme?.spotSize,
    spotFontSize: node.theme?.spotFontSize,
    spotMargin: node.theme?.spotMargin,
  });
}

// ---------------------------------------------------------------------------
// Content factory
// ---------------------------------------------------------------------------

/**
 * FinalizeBody callback for entities that skip auto-separator
 * (e.g. object, state). Returns emptyBodyPad for empty body.
 */
function skipAutoSeparator(ctx: FinalizeBodyCtx, theme?: Theme): Partial<Record<string, any>> {
  if (ctx.lines.length === 0) return { emptyBodyPad: theme?.padS ?? 10 };
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
  theme?: Theme;
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
    fontSize: node.theme?.fontSize,
    fontFamily: node.theme?.fontFamily,
    theme: node.theme,
    finalizeBody: skipAutoSep ? skipAutoSeparator : undefined,
  });
}

// ---------------------------------------------------------------------------
// Sizing (backward-compatible wrappers)
// ---------------------------------------------------------------------------

/** Compute title bar height for a class node. */
export function computeTitleH(node: { label: string; stereotype?: string | null; type?: string; stereotypeLabel?: string; hideCircle?: boolean; theme?: Theme }): number {
  return classContent({ id: '', ...node }).measure().titleHeight!;
}

// ---------------------------------------------------------------------------
// DrawIO styles
// ---------------------------------------------------------------------------

/** Generate swimlane style string for a class node mxCell. */
export function classNodeStyle(node: { stereotype?: string | null; type?: string; label: string; stereotypeLabel?: string; style?: string | null; hideCircle?: boolean }, startSize?: number, theme?: { arcSize: number; classFill: string; strokeWidth: number; fontSize?: number; fontFamily?: string }): string {
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
    `arcSize=${theme?.arcSize ?? 4}`,
    'shadow=0',
    `strokeWidth=${theme?.strokeWidth ?? 1}`,
  ];

  // Font size / family
  if (theme?.fontSize) base.push(`fontSize=${theme.fontSize}`);
  if (theme?.fontFamily) base.push(`fontFamily=${theme.fontFamily}`);

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
    else if (parsed.lineStyle === 'bold') base.push(`strokeWidth=${(theme?.strokeWidth ?? 1) * 2}`);
  }

  // Default white fill when no custom fill specified
  if (!base.some(s => s.startsWith('fillColor='))) {
    base.push(`fillColor=${theme?.classFill ?? '#FFFFFF'}`);
  }

  return base.join(';') + ';';
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
    super(node.id, node.theme);
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
    return this.skipAutoSep ? skipAutoSeparator(ctx, this.theme) : null;
  }

  protected getContainerStyle(titleHeight: number) {
    return classNodeStyle(this.node, titleHeight, this.theme);
  }

  protected getChildStyleOpts() {
    return {
      childStroke: this.childStroke,
      childLineStyle: this.childLineStyle,
      portConstraint: true as const,
      spacingX: this.theme.padXS,
    };
  }

  /**
   * Build layout graph node with ports derived from body rows.
   */
  override buildLayoutGraph(): LayoutGraphNode {
    const node = super.buildLayoutGraph();
    const pp = this.content.portPositions();

    if (pp.length > 0) {
      node.ports = pp.map(p => ({
        id: p.id,
        width: node.width,
        height: p.height,
        y: p.y,
      }));
    }

    return node;
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

