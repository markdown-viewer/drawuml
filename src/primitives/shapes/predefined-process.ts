/**
 * Predefined-process shape renderer — rectangle with vertical lines on sides.
 *
 * Used by PlantUML SDL stereotype <<procedure>>.
 * Renders using DrawIO `shape=process` (Process2Handler in drawio2svg).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class PredefinedProcessRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=process;whiteSpace=wrap;html=1;`
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;
  }

  // Extra horizontal padding for the inner vertical lines
  protected shapePadding(): ShapePadding {
    return { left: 10, right: 10 };
  }
}

export function registerPredefinedProcessShape(): void {
  registerRenderer('predefined-process', (desc: RenderDescriptor) => new PredefinedProcessRenderer(desc));
}
