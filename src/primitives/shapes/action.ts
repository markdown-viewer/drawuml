/**
 * Action shape renderer — standalone deployment node.
 *
 * PlantUML renders `action` as a pentagon (flat left, arrow right).
 * Uses DrawIO `singleArrow` with arrowWidth=1 to fill the full height,
 * producing a flat-left, pointed-right pentagon shape.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import type { SeparatorBoundsFn } from '../../shared/content-types.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import { n4 } from '../../shared/xml-utils.ts';

class ActionRenderer extends RichRenderer {
  // Render-time width for computing arrowSize ratio
  private _renderWidth = 0;

  protected buildStyle(): string {
    // arrowSize is a ratio of width; compute from cornerClip / actual width
    const arrowRatio = this._renderWidth > 0
      ? n4(this.theme.cornerClip / this._renderWidth) : '0.12';
    return `shape=singleArrow;arrowWidth=1;arrowSize=${arrowRatio};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;collapsible=0;container=1;`;
  }
  // Extra padding for the arrow tip
  protected shapePadding(): ShapePadding { return { right: this.theme.cornerClip }; }

  // Separator extends to the arrow tip edge at the given y
  protected separatorBounds(boxW: number, boxH: number): SeparatorBoundsFn | undefined {
    const clip = this.theme.cornerClip;
    const halfH = boxH / 2;
    return (centerY: number) => {
      // singleArrow: (0,0)→(w-s,0)→(w,h/2)→(w-s,h)→(0,h)
      // Right arrow widest at center, narrowest at edges
      const dy = Math.abs(centerY - halfH);
      const rightInset = halfH > 0 ? clip * dy / halfH : 0;
      return { x: 0, width: boxW - rightInset };
    };
  }

  override render(box: ContentBox): string[] {
    this._renderWidth = this.frameBox(box).width;
    return super.render(box);
  }
}

export function registerActionShape(): void {
  registerRenderer('action', (desc: RenderDescriptor) => new ActionRenderer(desc));
}
