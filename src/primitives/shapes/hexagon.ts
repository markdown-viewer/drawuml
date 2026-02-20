/**
 * Hexagon shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `hexagon` shape.
 */

import { ShapeRenderer } from './shape-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class HexagonRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;size=15;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;collapsible=0;container=1;`;
  }
  // Extra horizontal padding for hexagon pointed sides (size=15 each side)
  protected get extraPadX(): number { return 30; }
}

export function registerHexagonShape(): void {
  registerRenderer('hexagon', (desc: RenderDescriptor) => new HexagonRenderer(desc));
}
