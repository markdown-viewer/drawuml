/**
 * Mindmap node shape renderer.
 *
 * Identical to LegendRenderer but uses theme.defaultFill (#F1F1F1)
 * instead of theme.legendFill (#DDDDDD), matching PlantUML's official
 * mindmap node style.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { normalizeColor } from '../../shared/color-utils.ts';

class MindmapNodeRenderer extends RichRenderer {
  // Always use rich body mode (desc.lines as content)
  protected detectRichBody(): boolean { return true; }
  protected getRichBodyLines(): string[] { return this.desc.lines || []; }

  protected shapePadding(): ShapePadding {
    const p = this.theme.edgeGap;
    return { left: p, right: p, top: p, bottom: p };
  }

  // Apply user color via normalizeColor, or default fill
  protected applyColorOverride(style: string): string {
    if (this.color) return style.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    return style.replace('fillColor=none', `fillColor=${this.theme.defaultFill}`);
  }

  protected buildStyle(): string {
    const arc = this.theme.largeArcSize;
    return `rounded=1;absoluteArcSize=1;arcSize=${arc};whiteSpace=wrap;html=1;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontSize=${this.theme.fontSize};fontFamily=${this.theme.fontFamily};`;
  }
}

/** Register mindmap-node renderer into global registry. */
export function registerMindmapNodeRenderer(): void {
  registerRenderer('mindmap-node', (desc: RenderDescriptor) => new MindmapNodeRenderer(desc));
}
