/**
 * Diamond icon renderer — small filled rhombus with no text label.
 *
 * Extends IconRenderer so diamond size follows theme.sizeM like all other
 * icon-based nodes (circle, actor, boundary, control, entity, junction…).
 */

import { mxVertex } from '../../shared/xml-utils.ts';
import { IconRenderer } from './icon-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class DiamondRenderer extends IconRenderer {
  constructor(desc: RenderDescriptor) {
    super(desc);
  }

  // Base 16×16 square — scaled by iconScale from IconRenderer
  // (defaults are fine, no override needed)

  render(box: ContentBox) {
    const dw = this.iconWidth;
    const dh = this.iconHeight;
    const dx = box.x + (box.width - dw) / 2;
    const dy = box.y + (box.height - dh) / 2;
    const style = 'rhombus;whiteSpace=wrap;html=1;'
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`;
    return [mxVertex({
      id: this.id, value: '', style,
      parent: this.parentId || '1',
      x: dx, y: dy, width: dw, height: dh,
    })];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDiamondRenderer(): void {
  registerRenderer('diamond', (desc: RenderDescriptor) => new DiamondRenderer(desc));
}
