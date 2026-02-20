/**
 * Node (cube) shape renderer — standalone node and container.
 *
 * Used for PlantUML `node` keyword — renders as a 3D box (cube).
 */

import { ShapeRenderer } from './shape-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class NodeCubeRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `shape=cube;whiteSpace=wrap;size=10;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=6;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
  // Extra space for the 3D perspective faces (left + top)
  protected get extraPadX(): number { return 10; }
  protected get extraPadY(): number { return 10; }
  // Offset content to avoid the 3D perspective faces (left + top, size=10)
  protected get contentXOffset(): number { return 10; }
  protected get contentYOffset(): number { return 10; }
}

export function registerNodeCubeShape(): void {
  registerRenderer('node', (desc: RenderDescriptor) => new NodeCubeRenderer(desc));
}
