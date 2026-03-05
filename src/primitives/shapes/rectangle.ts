/**
 * Rectangle shape renderer — standalone node and container.
 *
 * Used for PlantUML `rectangle` keyword and `skinparam packageStyle rectangle`.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class RectangleRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.basic.rect;rounded=1;absoluteArcSize=1;arcSize=${this.theme.arcSize};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.fontSize / 6)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
}

export function registerRectangleShape(): void {
  const factory = (desc: RenderDescriptor) => new RectangleRenderer(desc);
  registerRenderer('rectangle', factory);
  registerRenderer('rect', factory);
}
