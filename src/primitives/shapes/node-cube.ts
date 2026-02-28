/**
 * Node (cube) shape renderer — standalone node and container.
 *
 * Used for PlantUML `node` keyword — renders as a 3D box (cube).
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class NodeCubeRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cube;whiteSpace=wrap;size=10;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=6;fillColor=none;strokeColor=${this.theme.colorDark};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // Extra width for 3D right face (size=10); symmetric, no label x-shift needed
  protected get extraPadX(): number { return 10; }
  // Top face height (size=10); reserves top area, pushes label down
  protected get topPadY(): number { return 10; }
  // Shift label right to avoid 3D left face overlap
  protected get contentXOffset(): number { return 10; }
}

export function registerNodeCubeShape(): void {
  registerRenderer('node', (desc: RenderDescriptor) => new NodeCubeRenderer(desc));
}
