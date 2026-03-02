/**
 * Node (cube) shape renderer — standalone node and container.
 *
 * Used for PlantUML `node` keyword — renders as a 3D box (cube).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class NodeCubeRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cube;whiteSpace=wrap;size=${this.theme.cornerClip};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=6;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // 3D cube: top face + left face overlap (left offset for label)
  protected shapePadding(): ShapePadding { return { top: this.theme.cornerClip, left: this.theme.cornerClip }; }
}

export function registerNodeCubeShape(): void {
  registerRenderer('node', (desc: RenderDescriptor) => new NodeCubeRenderer(desc));
}
