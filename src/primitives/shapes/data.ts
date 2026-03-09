/**
 * Parallelogram shape renderers — SDL load (right-leaning) and save (left-leaning).
 *
 * <<load>> renders as `\=\` (default parallelogram).
 * <<save>> renders as `/=/` (flipped via flipH).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class LoadRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;size=20;flipH=1;`
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;
  }

  protected shapePadding(): ShapePadding {
    return { left: 20, right: 20 };
  }
}

class SaveRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;size=20;`
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;
  }

  protected shapePadding(): ShapePadding {
    return { left: 20, right: 20 };
  }
}

export function registerLoadSaveShapes(): void {
  registerRenderer('load', (desc: RenderDescriptor) => new LoadRenderer(desc));
  registerRenderer('save', (desc: RenderDescriptor) => new SaveRenderer(desc));
}
