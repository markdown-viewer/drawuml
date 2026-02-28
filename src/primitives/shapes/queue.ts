/**
 * Queue shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `cylinder3` with `direction=south` (horizontal cylinder).
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class QueueRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cylinder3;size=10;direction=south;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;spacingRight=10;fillColor=none;strokeColor=${this.theme.colorDark};fontColor=${this.theme.colorDark};whiteSpace=wrap;container=1;collapsible=0;`;
  }
  // Extra width accounts for the cylinder end caps
  protected get extraPadX(): number { return 20; }
}

export function registerQueueShape(): void {
  registerRenderer('queue', (desc: RenderDescriptor) => new QueueRenderer(desc));
}
