// Renderer for mxgraph icon nodes.
// Renders a standalone icon with a label below (no frame).
// The shapeKey (e.g. "mxgraph.aws4.compute.awsLambda") drives both icon
// lookup in icon-registry and the DrawIO `shape=...` style property.

import { Renderer } from '../renderer.ts';
import type { DotContext } from '../renderer.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { DEFAULT_FONT_SIZE, COLOR_DARK } from '../../shared/theme.ts';
import { lookupIcon, resolveShapeRef } from '../../shared/icon-registry.ts';
import type { IconRecord } from '../../shared/icon-registry.ts';

// Default icon dimensions when the shapeKey is not found in icon-data.
const DEFAULT_ICON_SIZE = 48;
// Gap between icon bottom and label top (px).
const LABEL_GAP = 4;
// Reserved height for the below-icon label.
const LABEL_HEIGHT = 20;
// Minimum horizontal padding added to icon width for DOT allocation.
const MIN_HORIZ_PAD = 16;

export class MxgraphIconRenderer extends Renderer {
  private readonly desc: RenderDescriptor;
  private readonly shapeKey: string;
  private readonly iconRecord: IconRecord | undefined;

  constructor(desc: RenderDescriptor) {
    super(desc.id);
    this.desc = desc;
    // stereotype holds the full dot-path key (e.g. "mxgraph.aws4.compute.awsLambda")
    this.shapeKey = desc.stereotype ?? '';
    this.iconRecord = this.shapeKey ? lookupIcon(this.shapeKey) : undefined;
  }

  private get iconW(): number { return this.iconRecord?.w ?? DEFAULT_ICON_SIZE; }
  private get iconH(): number { return this.iconRecord?.h ?? DEFAULT_ICON_SIZE; }
  private get label(): string { return this.desc.label ?? ''; }

  protected doMeasure(): { width: number; height: number } {
    return {
      width:  this.iconW + MIN_HORIZ_PAD,
      height: this.iconH + LABEL_GAP + LABEL_HEIGHT,
    };
  }

  buildDotBlock(_ctx: DotContext, indent: string): string[] {
    return [`${indent}"${this.id}" [${this.buildDotAttributes(false)}]`];
  }

  render(box: ContentBox): string[] {
    const iw = this.iconW;
    const ih = this.iconH;

    // Extra style from icon-data (e.g. fillColor for AWS/archimate layer colors)
    const dataStyle   = this.iconRecord?.style ?? '';
    // User-specified inline color (#RRGGBB or #Name)
    const inlineColor = this.desc.style;

    // Only emit fillColor=none when dataStyle doesn't already supply a fillColor
    const defaultFill = dataStyle.includes('fillColor=') ? null : 'fillColor=none';

    // For variant icons (e.g. mxgraph.bpmn.event.start), the DrawIO shape key
    // is the parent group (mxgraph.bpmn.event); variant params are in dataStyle.
    const shapeRef = resolveShapeRef(this.shapeKey);

    // Build base DrawIO style
    let style = [
      `shape=${shapeRef}`,
      'html=1',
      'verticalLabelPosition=bottom',
      'verticalAlign=top',
      'align=center',
      `fontSize=${DEFAULT_FONT_SIZE}`,
      defaultFill,
      `strokeColor=${COLOR_DARK}`,
      `fontColor=${COLOR_DARK}`,
      dataStyle,
    ].filter(Boolean).join(';') + ';';

    // Apply user inline style overrides (parseNodeStyle handles #fill ##stroke etc.)
    const { style: styledStyle } = Renderer.applyInlineStyle(style, inlineColor);
    style = styledStyle;

    // Center icon horizontally within the DOT-allocated box
    const ix = box.x + Math.round((box.width - iw) / 2);

    return [mxVertex({
      id:     this.id,
      value:  this.label,
      style,
      parent: this.parentId ?? '1',
      x: ix,
      y: box.y,
      width:  iw,
      height: ih,
    })];
  }
}

/** Factory registration function — called once from primitives/index.ts. */
export function registerMxgraphIconRenderer(): void {
  // No explicit key registration needed — routing is done via wildcard
  // in createNodeRenderer() based on stereotype.startsWith('mxgraph.').
  // This export exists so index.ts can import the class, ensuring the
  // module is bundled.
}
