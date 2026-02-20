/**
 * Queue shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `cylinder3` with `direction=south` (horizontal cylinder).
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { ShapeRenderer } from './shape-renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

class QueueRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `shape=cylinder3;size=10;direction=south;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;spacingRight=10;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;`;
  }
  // Extra width accounts for the cylinder end caps
  protected get extraPadX(): number { return 20; }
  get isCluster(): boolean { return false; }

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    let s = this.buildStyle();
    if (this.color) s = s.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    return [mxVertex({
      id: this.id, value: labelHtml, style: s,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: box.height,
    })];
  }
}

export function registerQueueShape(): void {
  registerRenderer('queue', (desc: RenderDescriptor) => new QueueRenderer(desc));
}
