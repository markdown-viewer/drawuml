/**
 * Mxgraph icon renderer — standalone icon with label below.
 *
 * Extends IconRenderer with dynamic icon dimensions from icon-registry
 * and mxgraph-specific DrawIO style generation.
 */

import { IconRenderer } from './icon-renderer.ts';
import { Renderer } from '../renderer.ts';
import { TextBlock } from '../../shared/text-block.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { lookupIcon, resolveShapeRef } from '../../shared/icon-registry.ts';
import type { IconRecord } from '../../shared/icon-registry.ts';
import { fontFamilyStyle } from '../../shared/theme.ts';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class MxgraphIconRenderer extends IconRenderer {
  private readonly shapeKey: string;
  private readonly iconRecord: IconRecord | undefined;

  constructor(desc: RenderDescriptor) {
    super(desc);
    // stereotype holds the full dot-path key (e.g. "mxgraph.aws4.compute.awsLambda")
    this.shapeKey = desc.stereotype ?? '';
    this.iconRecord = this.shapeKey ? lookupIcon(this.shapeKey) : undefined;
  }

  // Use icon-data dimensions as aspect-ratio base; scale via mxgraphIconSize
  protected override get baseIconWidth(): number { return this.iconRecord?.w ?? this.theme.sizeXL; }
  protected override get baseIconHeight(): number { return this.iconRecord?.h ?? this.theme.sizeXL; }
  // Normalise the *wide* side to mxgraphIconSize so the icon fits within bounds
  protected override get iconScale(): number {
    return this.theme.sizeXL / Math.max(this.baseIconWidth, this.baseIconHeight);
  }
  protected override get paddingX(): number { return this.theme.padM; }
  protected override get minLabelHeight(): number { return this.theme.sizeS; }

  // Override: padding applies to icon width too
  protected override doMeasure(): { width: number; height: number } {
    const size = this.measureLabel();
    const labelH = Math.max(Math.ceil(size.height), this.minLabelHeight);
    const labelW = Math.ceil(size.width);
    return {
      width:  Math.max(this.iconWidth + this.paddingX, labelW + this.paddingX),
      height: this.iconHeight + this.iconGap + labelH,
    };
  }

  render(box: ContentBox): string[] {
    const iw = this.iconWidth;
    const ih = this.iconHeight;

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
      `fontSize=${this.theme.fontSize}`,
      defaultFill,
      `strokeColor=${this.theme.colorDark}`,
      `fontColor=${this.theme.colorDark}`,
      `strokeWidth=${this.theme.strokeWidth}`,
      dataStyle,
    ].filter(Boolean).join(';') + ';' + fontFamilyStyle(this.theme);

    // Apply user inline style overrides (parseNodeStyle handles #fill ##stroke etc.)
    const { style: styledStyle } = Renderer.applyInlineStyle(style, inlineColor, this.theme.boldStrokeWidth);
    style = styledStyle;

    // Center icon horizontally within the DOT-allocated box
    const ix = box.x + (box.width - iw) / 2;

    // Use TextBlock.inline to match measureLabel() pipeline (unescape + creole)
    const labelHtml = TextBlock.inline(this.label, { size: this.theme.fontSize, family: this.theme.fontFamily }).html;
    return [mxVertex({
      id:     this.id,
      value:  labelHtml,
      style,
      parent: this.parentId ?? '1',
      x: ix,
      y: box.y,
      width:  iw,
      height: ih,
    })];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Factory registration function — called once from primitives/index.ts. */
export function registerMxgraphIconRenderer(): void {
  // No explicit key registration needed — routing is done via wildcard
  // in createNodeRenderer() based on stereotype.startsWith('mxgraph.').
  // This export exists so index.ts can import the class, ensuring the
  // module is bundled.
}
