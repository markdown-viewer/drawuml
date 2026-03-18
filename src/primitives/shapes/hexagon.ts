/**
 * Hexagon shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `hexagon` shape.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import type { SeparatorBoundsFn } from '../../shared/content-types.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { n4 } from '../../shared/xml-utils.ts';

class HexagonRenderer extends RichRenderer {
  protected buildStyle(): string {
    const size = this.theme.cornerClip * 1.5;
    return `shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;size=${n4(size)};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.padXXS)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;collapsible=0;container=1;`;
  }
  // Extra horizontal padding for hexagon pointed sides
  protected shapePadding(): ShapePadding {
    const size = this.theme.cornerClip * 1.5;
    return { left: size, right: size };
  }

  // Separator spans between the hexagon slanted edges at the given y
  protected separatorBounds(boxW: number, boxH: number): SeparatorBoundsFn | undefined {
    const size = this.theme.cornerClip * 1.5;
    const halfH = boxH / 2;
    return (centerY: number) => {
      // Hexagon: (s,0)→(w-s,0)→(w,h/2)→(w-s,h)→(s,h)→(0,h/2)
      // Widest at center (full width), narrowest at top/bottom edges (inset by size)
      const dy = Math.abs(centerY - halfH);
      const ratio = halfH > 0 ? dy / halfH : 0;
      const inset = size * ratio;
      return { x: inset, width: boxW - inset * 2 };
    };
  }
}

export function registerHexagonShape(): void {
  registerRenderer('hexagon', (desc: RenderDescriptor) => new HexagonRenderer(desc));
}
