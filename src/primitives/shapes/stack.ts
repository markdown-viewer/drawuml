/**
 * Stack shape renderer — standalone deployment node.
 *
 * Renders as multiple stacked rectangles using DrawIO `mxgraph.basic.layered_rect` shape.
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE, RECT_ARC_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class StackRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.basic.layered_rect;rounded=1;absoluteArcSize=1;arcSize=${RECT_ARC_SIZE};fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;collapsible=0;container=1;`;
  }
}

export function registerStackShape(): void {
  registerRenderer('stack', (desc: RenderDescriptor) => new StackRenderer(desc));
}
