/**
 * Cloud shape renderer — standalone node and container.
 *
 * Used for PlantUML `cloud` keyword.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import type { SeparatorBoundsFn } from '../../shared/content-types.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class CloudRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cloud;whiteSpace=wrap;size=0.5;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.fontSize / 6)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // Cloud arc border + corner radius inset
  protected shapePadding(): ShapePadding {
    return { left: this.theme.padS, right: this.theme.padS, top: this.theme.padXS, bottom: this.theme.padXS };
  }

  // Separator follows the cloud valley envelope (rounded rect inset by depth)
  protected separatorBounds(boxW: number, boxH: number): SeparatorBoundsFn | undefined {
    // Matches procedural cloud params in drawio2svg (size=0.5)
    const minDim = Math.min(boxW, boxH);
    const depth = 0.04 * minDim;
    const cornerR = 0.15 * minDim;
    const r = cornerR - depth;
    return (centerY: number) => {
      let leftX: number;
      if (centerY < cornerR) {
        // top-corner arc zone
        const dy = cornerR - centerY;
        leftX = dy < r ? cornerR - Math.sqrt(r * r - dy * dy) : depth;
      } else if (centerY > boxH - cornerR) {
        // bottom-corner arc zone
        const dy = centerY - (boxH - cornerR);
        leftX = dy < r ? cornerR - Math.sqrt(r * r - dy * dy) : depth;
      } else {
        // straight edge zone
        leftX = depth;
      }
      return { x: leftX, width: boxW - 2 * leftX };
    };
  }
}

export function registerCloudShape(): void {
  registerRenderer('cloud', (desc: RenderDescriptor) => new CloudRenderer(desc));
}
