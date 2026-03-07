/**
 * Queue shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `cylinder3` with `direction=south` (horizontal cylinder).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import type { SeparatorBoundsFn } from '../../shared/content-types.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class QueueRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cylinder3;size=${this.theme.sizeXS};direction=south;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.fontSize / 6)};spacingRight=${this.theme.sizeXS};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;container=1;collapsible=0;`;
  }
  // Extra width for the cylinder end caps
  protected shapePadding(): ShapePadding {
    return { left: this.theme.sizeXS, right: this.theme.sizeXS * 2 };
  }

  // Separator spans between the cylinder arcs at the given y
  protected separatorBounds(boxW: number, boxH: number): SeparatorBoundsFn | undefined {
    const capLeft = this.theme.sizeXS;
    const capRight = this.theme.sizeXS;
    const straightWidth = boxW - capLeft - capRight;
    const ry = boxH / 2;
    return (centerY: number) => {
      const dy = Math.abs(centerY - ry);
      const t = 1 - (dy * dy) / (ry * ry);
      const bulge = t > 0 ? Math.sqrt(t) : 0;
      const x0 = capLeft * (1 - bulge);
      return { x: x0, width: straightWidth };
    };
  }
}

export function registerQueueShape(): void {
  registerRenderer('queue', (desc: RenderDescriptor) => new QueueRenderer(desc));
}
