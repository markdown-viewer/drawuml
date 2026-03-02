/**
 * Stack shape renderer — standalone deployment node.
 *
 * Renders as multiple stacked rectangles using DrawIO `mxgraph.basic.layered_rect` shape.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class StackRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.basic.layered_rect;rounded=1;absoluteArcSize=1;arcSize=${this.theme.arcSize};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;collapsible=0;container=1;`;
  }
}

export function registerStackShape(): void {
  registerRenderer('stack', (desc: RenderDescriptor) => new StackRenderer(desc));
}
