/**
 * Card shape renderer — standalone node and container.
 *
 * Used for PlantUML `card` keyword — renders as a rectangle with
 * a horizontal divider line (archimate businessObject shape).
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE, RECT_ARC_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class CardRenderer extends RichRenderer {
  protected buildStyle(): string {
    // Use plain rectangle when card has title only (no body content and no children)
    const hasContent = this.desc.bodyLines && this.desc.bodyLines.length > 0;
    if (!hasContent && !this.isCluster) {
      return `shape=mxgraph.basic.rect;rounded=1;absoluteArcSize=1;arcSize=${RECT_ARC_SIZE};fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
    }
    return `shape=mxgraph.archimate.businessObject;size=20;rounded=1;absoluteArcSize=1;arcSize=${RECT_ARC_SIZE};fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=-2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
}

export function registerCardShape(): void {
  registerRenderer('card', (desc: RenderDescriptor) => new CardRenderer(desc));
}
