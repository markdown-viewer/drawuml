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
  // Procedural cloud (size<1): thin arc border (~0.04*min) + corner radius (~0.15*min).
  // Content area inset is small; add minimal extra padding for visual comfort.
  protected get extraPadY(): number { return 6; }
  protected get extraPadX(): number { return 10; }
}

export function registerCloudShape(): void {
  registerRenderer('cloud', (desc: RenderDescriptor) => new CloudRenderer(desc));
}
