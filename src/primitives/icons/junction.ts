/**
 * Junction icon renderer — small filled/empty circle with text label below.
 *
 * Used for archimate Junction_And (filled black) and Junction_Or (empty).
 * Extends IconRenderer with the standard icon-below-label layout,
 * using theme.iconSize for consistent sizing across all icon renderers.
 */

import { IconRenderer } from './icon-renderer.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class JunctionRenderer extends IconRenderer {
  private fillColor: string;
  private strokeColor: string;

  constructor(desc: RenderDescriptor, fillColor: string, strokeColor: string) {
    super(desc);
    this.fillColor = fillColor;
    this.strokeColor = strokeColor;
  }

  // Base 16×16 circle — scaled by iconScale from IconRenderer
  // (baseIconWidth/baseIconHeight default to 16, no override needed)

  render(box: ContentBox): string[] {
    const d = this.iconWidth;
    const cx = box.x + Math.round((box.width - d) / 2);
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
    ].join(';') + ';';
    return [mxVertex({
      id: this.id,
      value: this.label,
      style,
      parent: this.parentId || '1',
      x: cx, y: box.y, width: d, height: d,
    })];
  }
}
