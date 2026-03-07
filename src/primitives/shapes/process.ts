/**
 * Process shape renderer — standalone deployment node.
 *
 * PlantUML renders `process` as a chevron/step shape (left notch, right arrow).
 * Uses DrawIO `step` shape which draws the same hexagonal arrow form.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import type { SeparatorBoundsFn } from '../../shared/content-types.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class ProcessRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=step;perimeter=stepPerimeter;fixedSize=1;size=${this.theme.cornerClip};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;collapsible=0;container=1;`;
  }
  // Extra horizontal padding for step pointed sides
  protected shapePadding(): ShapePadding { return { left: this.theme.cornerClip, right: this.theme.cornerClip }; }

  // Separator spans between the step notch/arrow at the given y
  protected separatorBounds(boxW: number, boxH: number): SeparatorBoundsFn | undefined {
    const clip = this.theme.cornerClip;
    const halfH = boxH / 2;
    return (centerY: number) => {
      // Left notch: (0,0)→(s,h/2)→(0,h) — deepest inset at center
      // Right arrow: (w-s,0)→(w,h/2)→(w-s,h) — widest at center
      const dy = Math.abs(centerY - halfH);
      const t = halfH > 0 ? dy / halfH : 0;
      const leftInset = clip * (1 - t);
      const rightInset = clip * t;
      return { x: leftInset, width: boxW - leftInset - rightInset };
    };
  }
}

export function registerProcessShape(): void {
  registerRenderer('process', (desc: RenderDescriptor) => new ProcessRenderer(desc));
}
