/**
 * SDL shape renderers — output, input, continuous.
 *
 * <<output>> renders as a pentagon with flat left and arrow tip right.
 * <<input>> renders as a pentagon with flat left and V-notch (concave) right.
 * <<continuous>> renders as two open `< >` bracket strokes (no filled body).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class OutputRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=horizontalPentagon;whiteSpace=wrap;html=1;fixedSize=1;size=10;`
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;
  }

  protected shapePadding(): ShapePadding {
    return { left: 0, right: 10 };
  }
}

class InputRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=sdlInput;whiteSpace=wrap;html=1;fixedSize=1;size=10;`
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;
  }

  protected shapePadding(): ShapePadding {
    return { left: 0, right: 10 };
  }
}

class ContinuousRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=sdlContinuous;whiteSpace=wrap;html=1;fixedSize=1;size=5;`
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;verticalAlign=middle;`;
  }

  protected shapePadding(): ShapePadding {
    return { left: 5, right: 5 };
  }
}

export function registerOffPageConnectorShapes(): void {
  registerRenderer('output', (desc: RenderDescriptor) => new OutputRenderer(desc));
  registerRenderer('input', (desc: RenderDescriptor) => new InputRenderer(desc));
  registerRenderer('continuous', (desc: RenderDescriptor) => new ContinuousRenderer(desc));
}
