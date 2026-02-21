/**
 * Person shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `mxgraph.c4.person2` shape (circle head + rounded body).
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class PersonRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.c4.person2;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;`;
  }
  // Extra height accounts for the head circle above the label
  protected get extraPadY(): number { return 38; }
  protected get contentYOffset(): number { return 38; }
  get isCluster(): boolean { return false; }
}

export function registerPersonShape(): void {
  registerRenderer('person', (desc: RenderDescriptor) => new PersonRenderer(desc));
}
