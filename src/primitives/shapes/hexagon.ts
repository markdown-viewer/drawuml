/**
 * Hexagon shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `hexagon` shape.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { n4 } from '../../shared/xml-utils.ts';

class HexagonRenderer extends RichRenderer {
  protected buildStyle(): string {
    const size = this.theme.cornerClip * 1.5;
    return `shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;size=${n4(size)};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.fontSize / 6)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;collapsible=0;container=1;`;
  }
  // Extra horizontal padding for hexagon pointed sides
  protected shapePadding(): ShapePadding {
    const size = this.theme.cornerClip * 1.5;
    return { left: size * 2, right: size * 2 };
  }
}

export function registerHexagonShape(): void {
  registerRenderer('hexagon', (desc: RenderDescriptor) => new HexagonRenderer(desc));
}
