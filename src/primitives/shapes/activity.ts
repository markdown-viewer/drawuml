/**
 * Activity node primitive — renders legacy activity diagram boxes
 * as rounded rectangles (or octagons) with centered text.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARC_SIZE = 25;

// Extra padding for octagon shape to prevent text clipped by cut corners
const OCTAGON_EXTRA_H = 14;
const OCTAGON_EXTRA_V = 6;

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class ActivityNodeRenderer extends RichRenderer {
  private get isOctagon(): boolean { return this.desc.activityShape === 'octagon'; }

  get isCluster(): boolean { return false; }

  protected buildStyle(): string {
    if (this.isOctagon) {
      return 'shape=mxgraph.basic.octagon;whiteSpace=wrap;html=1;'
        + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=0.5;`
        + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;
    }
    return 'rounded=1;whiteSpace=wrap;html=1;'
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=0.5;`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`
      + `arcSize=${ARC_SIZE};`;
  }

  protected get extraPadX(): number { return this.isOctagon ? OCTAGON_EXTRA_H : 0; }
  protected get extraPadY(): number { return this.isOctagon ? OCTAGON_EXTRA_V : 0; }
}

/** Register activity-node renderer into global registry. */
export function registerActivityNodeRenderer(): void {
  registerRenderer('activity', (desc: RenderDescriptor) => new ActivityNodeRenderer(desc));
}
