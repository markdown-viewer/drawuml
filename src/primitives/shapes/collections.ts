/**
 * Collections shape renderer — standalone deployment node.
 *
 * Renders as two overlapping rectangles (offset shadow + main rect).
 */

import { mxVertex } from '../../shared/xml-utils.ts';
import { RichRenderer } from './rich-renderer.ts';
import { Renderer } from '../renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

/** Offset between the back and front rectangles. */
const SHADOW_OFFSET = 5;

class CollectionsRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.basic.rect;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;fillColor=#FFFFFF;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;`;
  }
  protected get extraPadX(): number { return SHADOW_OFFSET; }
  protected get extraPadY(): number { return SHADOW_OFFSET; }
  get isCluster(): boolean { return false; }

  // Front rect is smaller than layout box by shadow offset
  protected frameBox(box: ContentBox): ContentBox {
    return { x: box.x, y: box.y, width: box.width - SHADOW_OFFSET, height: box.height - SHADOW_OFFSET };
  }

  // Back shadow rectangle rendered behind main frame
  protected renderExtraCells(box: ContentBox): string[] {
    let bs = `rounded=0;fillColor=none;strokeColor=${COLOR_DARK};`;
    if (this.color) bs = bs.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    { const r = Renderer.applyInlineStyle(bs, this.desc.style); bs = r.style; }
    return [mxVertex({
      id: `${this.id}__back`, value: '', style: bs,
      parent: this.parentId || '1',
      x: box.x + SHADOW_OFFSET, y: box.y + SHADOW_OFFSET,
      width: box.width - SHADOW_OFFSET, height: box.height - SHADOW_OFFSET,
    })];
  }
}

export function registerCollectionsShape(): void {
  registerRenderer('collections', (desc: RenderDescriptor) => new CollectionsRenderer(desc));
}
