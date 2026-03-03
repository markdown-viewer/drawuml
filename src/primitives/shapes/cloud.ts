/**
 * Cloud shape renderer — standalone node and container.
 *
 * Used for PlantUML `cloud` keyword.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class CloudRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cloud;whiteSpace=wrap;size=0.5;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // Cloud arc border + corner radius inset
  protected shapePadding(): ShapePadding {
    return { left: this.theme.padS, right: this.theme.padS, top: this.theme.padXS, bottom: this.theme.padXS };
  }
}

export function registerCloudShape(): void {
  registerRenderer('cloud', (desc: RenderDescriptor) => new CloudRenderer(desc));
}
