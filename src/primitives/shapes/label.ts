/**
 * Label shape renderer — standalone deployment node.
 *
 * Renders as plain text with no border or background (just the label).
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { ShapeRenderer } from './shape-renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

class LabelRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `text;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;fillColor=none;strokeColor=none;fontColor=${COLOR_DARK};whiteSpace=wrap;`;
  }
  get isCluster(): boolean { return false; }

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    let s = this.buildStyle();
    // Label shape uses fontColor instead of fillColor for color override
    if (this.color) s = s.replace(/fontColor=[^;]*/, `fontColor=${normalizeColor(this.color)}`);
    return [mxVertex({
      id: this.id, value: labelHtml, style: s,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: box.height,
    })];
  }
}

export function registerLabelShape(): void {
  registerRenderer('label', (desc: RenderDescriptor) => new LabelRenderer(desc));
}
