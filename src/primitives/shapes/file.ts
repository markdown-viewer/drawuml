/**
 * File shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `note2` shape (rectangle with folded corner).
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class FileRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=note2;rounded=1;absoluteArcSize=1;arcSize=${this.theme.arcSize};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.padXXS)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;size=${this.theme.cornerClip};collapsible=0;container=1;`;
  }
}

export function registerFileShape(): void {
  registerRenderer('file', (desc: RenderDescriptor) => new FileRenderer(desc));
}
