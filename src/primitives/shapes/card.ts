/**
 * Card shape renderer — standalone node and container.
 *
 * Used for PlantUML `card` keyword — renders as a rectangle with
 * a horizontal divider line (archimate businessObject shape).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class CardRenderer extends RichRenderer {
  protected shapePadding(): ShapePadding { return {}; }
  protected override get hasTitlebar(): boolean { return true; }

  protected buildStyle(): string {
    // Use plain rectangle when card has title only (no body content and no children)
    const hasContent = this.desc.bodyLines && this.desc.bodyLines.length > 0;
    if (!hasContent && !this.isCluster) {
      return `shape=mxgraph.basic.rect;rounded=1;absoluteArcSize=1;arcSize=${this.theme.arcSize};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
    }
    // Swimlane with startSize gives a proper title bar header, matching state/class node pattern
    return `swimlane;startSize=${this.theme.titleBarHeight};swimlaneLine=1;rounded=1;absoluteArcSize=1;arcSize=${this.theme.arcSize};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
}

export function registerCardShape(): void {
  registerRenderer('card', (desc: RenderDescriptor) => new CardRenderer(desc));
}
