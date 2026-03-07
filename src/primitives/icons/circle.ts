/**
 * Circle node renderer — small filled circle with text label below.
 *
 * Extends IconRenderer with circle-specific measurement (TITLE_FONT_SIZE)
 * and ellipse-based DrawIO style with labelWidth control.
 */

import { IconRenderer } from './icon-renderer.ts';
import { Renderer } from '../renderer.ts';
import { TextBlock } from '../../shared/text-block.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { buildLabelHtml } from '../label.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor, NodeDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import { fontFamilyStyle } from '../../shared/theme.ts';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class CircleRenderer extends IconRenderer {
  private textBlock: TextBlock;

  constructor(desc: RenderDescriptor) {
    super(desc);
    this.textBlock = TextBlock.inline(this.label, {
      size: this.theme.titleFontSize,
      family: this.theme.fontFamily,
    });
  }

  protected override get iconGap(): number { return this.theme.padM; }
  protected override get paddingX(): number { return this.theme.padXL; }

  // Override: circle uses titleFontSize for measurement
  protected override measureLabel() {
    return this.textBlock.measure();
  }

  // Override: padding applies to icon width too
  protected override doMeasure() {
    const size = this.measureLabel();
    const labelH = Math.max(Math.ceil(size.height), this.minLabelHeight);
    const textWidth = Math.ceil(size.width);
    return {
      width: Math.max(textWidth + this.paddingX, this.iconWidth + this.paddingX),
      height: this.iconHeight + this.iconGap + labelH,
    };
  }

  render(box: ContentBox) {
    const d = this.iconWidth;
    const cx = box.x + (box.width - d) / 2;
    const cy = box.y;
    // Use actual text width as labelWidth to prevent wrapping without over-expanding
    const textWidth = Math.ceil(this.textBlock.width);
    const labelWidth = Math.max(textWidth + 4, d);
    let s = 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;'
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.titleFontSize};fontColor=${this.theme.colorDark};`
      + 'verticalLabelPosition=bottom;labelPosition=center;verticalAlign=top;align=center;'
      + `labelWidth=${labelWidth};`
      + fontFamilyStyle(this.theme);
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style, this.theme.boldStrokeWidth);
    s = styledS;
    if (fontColorOverride) s = s.replace(/fontColor=[^;]*;/, fontColorOverride);
    return [mxVertex({
      id: this.desc.id, value: buildLabelHtml({
        label: this.textBlock.html,
        stereotypeLabel: this.desc.stereotypeLabel || undefined,
        fontSize: this.theme.fontSize,
      }), style: s,
      parent: this.parentId || '1',
      x: cx, y: cy, width: d, height: d,
    })];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCircleRenderer(): void {
  const factory = (desc: RenderDescriptor) => new CircleRenderer(desc);
  registerRenderer('circle', factory);
}
