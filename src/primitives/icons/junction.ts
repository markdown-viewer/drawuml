/**
 * Junction icon renderer — small filled/empty circle with text label below.
 *
 * Used for archimate Junction_And (filled black) and Junction_Or (empty).
 * Extends IconRenderer with the standard icon-below-label layout,
 * using theme.sizeM for consistent sizing across all icon renderers.
 */

import { IconRenderer } from './icon-renderer.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import { fontFamilyStyle } from '../../shared/theme.ts';
import { TextBlock } from '../../shared/text-block.ts';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class JunctionRenderer extends IconRenderer {
  private fillColor: string;
  private strokeColor: string;

  constructor(desc: RenderDescriptor, fillColor: string, strokeColor?: string) {
    super(desc);
    // Per-node color (from !define macro) overrides registration-time default
    this.fillColor = normalizeColor(desc.color) ?? normalizeColor(fillColor) ?? fillColor;
    this.strokeColor = normalizeColor(strokeColor) ?? this.theme.colorDark;
  }

  // Half-size icon: junction circle is smaller than standard icons
  protected override get iconScale(): number {
    return super.iconScale * 0.5;
  }

  render(box: ContentBox): string[] {
    const d = this.iconWidth;
    const cx = box.x + (box.width - d) / 2;
    const style = [
      'ellipse',
      `fillColor=${this.fillColor}`,
      `strokeColor=${this.strokeColor}`,
      `strokeWidth=${this.theme.strokeWidth}`,
      `fontColor=${this.theme.colorDark}`,
      'verticalLabelPosition=bottom',
      'verticalAlign=top',
      'align=center',
      'html=1',
      `fontSize=${this.theme.fontSize}`,
    ].join(';') + ';' + fontFamilyStyle(this.theme);
    // Use TextBlock.inline to match measureLabel() pipeline
    const labelHtml = TextBlock.inline(this.label, { size: this.theme.fontSize, family: this.theme.fontFamily }).html;
    return [mxVertex({
      id: this.id,
      value: labelHtml,
      style,
      parent: this.parentId || '1',
      x: cx, y: box.y, width: d, height: d,
    })];
  }
}
