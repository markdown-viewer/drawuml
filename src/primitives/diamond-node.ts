/**
 * Diamond node primitive — sizing and rendering for diamond-stereotype entities.
 * PlantUML renders these as small filled rhombus shapes with no text label.
 */

import { mxVertex } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import type { Theme } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';
import type { SemanticNode } from '../model/class-model.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIAMOND_SIZE = 24;  // PlantUML: 24x24 polygon

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class DiamondNodeRenderer extends Renderer {
  private node: { id: string };

  constructor(node: { id: string; theme?: Theme }) {
    super(node.id, node.theme);
    this.node = node;
  }

  protected doMeasure() {
    return { width: DIAMOND_SIZE, height: DIAMOND_SIZE };
  }

  render(box: ContentBox) {
    const dw = DIAMOND_SIZE;
    const dh = DIAMOND_SIZE;
    const dx = box.x + Math.round((box.width - dw) / 2);
    const dy = box.y + Math.round((box.height - dh) / 2);
    const style = 'rhombus;whiteSpace=wrap;html=1;'
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=0.5;`;
    return [mxVertex({
      id: this.node.id, value: '', style,
      parent: this.parentId || '1',
      x: dx, y: dy, width: dw, height: dh,
    })];
  }
}

/** Register diamond-node renderer into global registry. */
export function registerDiamondNodeRenderer(): void {
  registerRenderer('diamond', (desc: RenderDescriptor) => new DiamondNodeRenderer(desc));
}

