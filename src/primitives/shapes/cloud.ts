/**
 * Cloud shape renderer — standalone node and container.
 *
 * Used for PlantUML `cloud` keyword.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class CloudRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cloud;whiteSpace=wrap;size=0.5;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${this.theme.colorDark};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // Procedural cloud (size<1): thin arc border (~0.04*min) + corner radius (~0.15*min).
  // Content area inset is small; add minimal extra padding for visual comfort.
  protected get extraPadY(): number { return 6; }
  protected get extraPadX(): number { return 10; }
}

export function registerCloudShape(): void {
  registerRenderer('cloud', (desc: RenderDescriptor) => new CloudRenderer(desc));
}
