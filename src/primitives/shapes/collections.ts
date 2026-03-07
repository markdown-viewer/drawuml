/**
 * Collections shape renderer — standalone deployment node.
 *
 * Renders as two overlapping rectangles (offset shadow + main rect).
 */

import { mxVertex } from '../../shared/xml-utils.ts';
import { RichRenderer } from './rich-renderer.ts';
import { Renderer } from '../renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import type { RenderDescriptor } from '../registry.ts';

class CollectionsRenderer extends RichRenderer {
  /** Offset between the back and front rectangles. */
  private get shadowOffset(): number { return this.theme.padXS; }

  protected buildStyle(): string {
    return `shape=mxgraph.basic.rect;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=#FFFFFF;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;`;
  }
  get isCluster(): boolean { return false; }

  // Front rect is smaller than layout box by shadow offset
  protected frameBox(box: ContentBox): ContentBox {
    const s = this.shadowOffset;
    return { x: box.x, y: box.y, width: box.width - s, height: box.height - s };
  }

  // Back shadow rectangle rendered behind main frame
  protected renderExtraCells(box: ContentBox): string[] {
    let bs = `rounded=0;fillColor=none;strokeColor=${this.theme.colorDark};`;
    if (this.color) bs = bs.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    { const r = Renderer.applyInlineStyle(bs, this.desc.style, this.theme.boldStrokeWidth); bs = r.style; }
    return [mxVertex({
      id: `${this.id}__back`, value: '', style: bs,
      parent: this.parentId || '1',
      x: box.x + this.shadowOffset, y: box.y + this.shadowOffset,
      width: box.width - this.shadowOffset, height: box.height - this.shadowOffset,
    })];
  }
}

export function registerCollectionsShape(): void {
  registerRenderer('collections', (desc: RenderDescriptor) => new CollectionsRenderer(desc));
}
