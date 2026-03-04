/**
 * Queue shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `cylinder3` with `direction=south` (horizontal cylinder).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class QueueRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cylinder3;size=${this.theme.sizeXS};direction=south;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=2;spacingRight=${this.theme.sizeXS};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;container=1;collapsible=0;`;
  }
  // Extra width for the cylinder end caps
  protected shapePadding(): ShapePadding {
    return { left: this.theme.sizeXS, right: this.theme.sizeXS * 2 };
  }
}

export function registerQueueShape(): void {
  registerRenderer('queue', (desc: RenderDescriptor) => new QueueRenderer(desc));
}
