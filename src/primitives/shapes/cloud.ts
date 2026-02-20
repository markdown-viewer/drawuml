/**
 * Cloud shape renderer — standalone node and container.
 *
 * Used for PlantUML `cloud` keyword.
 */

import { ShapeRenderer } from './shape-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class CloudRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `shape=cloud;whiteSpace=wrap;size=0.5;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
}

export function registerCloudShape(): void {
  registerRenderer('cloud', (desc: RenderDescriptor) => new CloudRenderer(desc));
}
