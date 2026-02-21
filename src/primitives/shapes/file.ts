/**
 * File shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `note2` shape (rectangle with folded corner).
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class FileRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=note2;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;size=10;collapsible=0;container=1;`;
  }
}

export function registerFileShape(): void {
  registerRenderer('file', (desc: RenderDescriptor) => new FileRenderer(desc));
}
