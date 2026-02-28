/**
 * Person shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `mxgraph.c4.person2` shape (circle head + rounded body).
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class PersonRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.c4.person2;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${this.theme.colorDark};fontColor=${this.theme.colorDark};whiteSpace=wrap;`;
  }
  // Head circle height ~38px; label starts below the head
  protected get topPadY(): number { return 38; }
  get isCluster(): boolean { return false; }
}

export function registerPersonShape(): void {
  registerRenderer('person', (desc: RenderDescriptor) => new PersonRenderer(desc));
}
