/**
 * Action shape renderer — standalone deployment node.
 *
 * PlantUML renders `action` as a pentagon (flat left, arrow right).
 * Uses DrawIO `singleArrow` with arrowWidth=1 to fill the full height,
 * producing a flat-left, pointed-right pentagon shape.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class ActionRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=singleArrow;arrowWidth=1;arrowSize=0.12;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;collapsible=0;container=1;`;
  }
  // Extra padding for the arrow tip
  protected shapePadding(): ShapePadding { return { left: this.theme.padM, right: this.theme.padM }; }
}

export function registerActionShape(): void {
  registerRenderer('action', (desc: RenderDescriptor) => new ActionRenderer(desc));
}
