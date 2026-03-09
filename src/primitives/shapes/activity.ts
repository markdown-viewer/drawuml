/**
 * Activity node primitive — renders legacy activity diagram boxes
 * as rounded rectangles (or octagons) with centered text.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class ActivityNodeRenderer extends RichRenderer {
  private get isOctagon(): boolean { return this.desc.activityShape === 'octagon'; }

  get isCluster(): boolean { return false; }

  protected buildStyle(): string {
    const base = `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;

    if (this.isOctagon) {
      return 'shape=mxgraph.basic.octagon;whiteSpace=wrap;html=1;' + base;
    }
    return 'rounded=1;absoluteArcSize=1;whiteSpace=wrap;html=1;' + base
      + `arcSize=${this.theme.largeArcSize};`;
  }

  protected shapePadding(): ShapePadding {
    return this.isOctagon ? { left: this.theme.padS, right: this.theme.padS, top: this.theme.padXS, bottom: this.theme.padXS } : {};
  }
}

/** Register activity-node renderer into global registry. */
export function registerActivityNodeRenderer(): void {
  registerRenderer('activity', (desc: RenderDescriptor) => new ActivityNodeRenderer(desc));
}
