/**
 * Process shape renderer — standalone deployment node.
 *
 * PlantUML renders `process` as a chevron/step shape (left notch, right arrow).
 * Uses DrawIO `step` shape which draws the same hexagonal arrow form.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class ProcessRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=step;perimeter=stepPerimeter;fixedSize=1;size=10;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=${this.theme.colorDark};fontColor=${this.theme.colorDark};whiteSpace=wrap;collapsible=0;container=1;`;
  }
  // Extra horizontal padding for step pointed sides (size=10 each side)
  protected get extraPadX(): number { return 20; }
}

export function registerProcessShape(): void {
  registerRenderer('process', (desc: RenderDescriptor) => new ProcessRenderer(desc));
}
