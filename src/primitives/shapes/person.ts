/**
 * Person shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `mxgraph.c4.person2` shape (circle head + rounded body).
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { ShapeRenderer } from './shape-renderer.ts';
import { Renderer } from '../renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

class PersonRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.c4.person2;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;`;
  }
  // Extra height accounts for the head circle above the label
  protected get extraPadY(): number { return 38; }
  get isCluster(): boolean { return false; }

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    let s = this.buildStyle();
    if (this.color) s = s.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style);
    s = styledS;
    if (fontColorOverride) s = s.replace(/fontColor=[^;]*;/, fontColorOverride);
    return [mxVertex({
      id: this.id, value: labelHtml, style: s,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: box.height,
    })];
  }
}

export function registerPersonShape(): void {
  registerRenderer('person', (desc: RenderDescriptor) => new PersonRenderer(desc));
}
