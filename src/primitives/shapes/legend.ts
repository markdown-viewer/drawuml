/**
 * Legend shape renderer — standalone legend node.
 *
 * Uses standard RichRenderer content layout — only shape and color differ.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class LegendRenderer extends RichRenderer {
  constructor(desc: RenderDescriptor) {
    super(desc);
  }

  get isCluster(): boolean { return false; }

  // Legend always uses rich body mode (desc.lines as content)
  protected detectRichBody(): boolean { return true; }
  protected getRichBodyLines(): string[] { return this.desc.lines || []; }

  protected getRichBodyMetrics(): Record<string, number | string> {
    return { minWidth: this.theme.legendMinW };
  }

  protected buildStyle(): string {
    const arc = this.theme.largeArcSize;
    return `rounded=1;absoluteArcSize=1;arcSize=${arc};whiteSpace=wrap;html=1;fillColor=${this.theme.legendFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontSize=${this.theme.fontSize};fontFamily=${this.theme.fontFamily};`;
  }

  // Legend colors are fixed; skip deployment color override
  protected applyColorOverride(s: string): string { return s; }
}

/** Register legend renderer into global registry. */
export function registerLegendRenderer(): void {
  registerRenderer('legend', (desc: RenderDescriptor) => new LegendRenderer(desc));
}
