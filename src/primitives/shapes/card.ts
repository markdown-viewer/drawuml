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
  // Only show titlebar when card is a cluster (has children);
  // standalone cards (label-only or with body) use a plain rect.
  protected override get hasTitlebar(): boolean {
    return this.isCluster;
  }
  protected override get titleAreaHeight(): number {
    return this.computeLabelHeight();
  }

  protected buildStyle(): string {
    if (!this.isCluster) {
      // Plain rectangle for standalone card (label-only or with body content)
      return `shape=mxgraph.basic.rect;rounded=1;absoluteArcSize=1;arcSize=${this.theme.arcSize};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
    }
    // Swimlane with title bar header for cluster card (has children)
    const startSize = this.computeLabelHeight();
    return `swimlane;html=1;whiteSpace=wrap;startSize=${startSize};swimlaneLine=1;rounded=1;absoluteArcSize=1;arcSize=${this.theme.arcSize};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }

  // Apply fillColor to both header and body area of the swimlane
  protected postProcessStyle(s: string): string {
    if (!this.isCluster) return s;
    return s.replace(
      /fillColor=([^;"]+)/,
      (_: string, c: string) => c === 'none' ? `fillColor=none` : `fillColor=${c};swimlaneFillColor=${c}`
    );
  }
}

export function registerCardShape(): void {
  registerRenderer('card', (desc: RenderDescriptor) => new CardRenderer(desc));
}
