/**
 * Collections shape renderer — standalone deployment node.
 *
 * Renders as two overlapping rectangles (offset shadow + main rect).
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { ShapeRenderer } from './shape-renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

/** Offset between the back and front rectangles. */
const SHADOW_OFFSET = 5;

class CollectionsRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.basic.rect;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;fillColor=#FFFFFF;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};whiteSpace=wrap;`;
  }
  protected get extraPadX(): number { return SHADOW_OFFSET; }
  protected get extraPadY(): number { return SHADOW_OFFSET; }
  get isCluster(): boolean { return false; }

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    const cells: string[] = [];

    // Back rectangle (offset to bottom-right)
    let bs = `rounded=0;fillColor=none;strokeColor=${COLOR_DARK};`;
    if (this.color) bs = bs.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    cells.push(mxVertex({
      id: `${this.id}__back`, value: '', style: bs,
      parent: this.parentId || '1',
      x: box.x + SHADOW_OFFSET, y: box.y + SHADOW_OFFSET,
      width: box.width - SHADOW_OFFSET, height: box.height - SHADOW_OFFSET,
    }));

    // Front rectangle (main)
    let fs = this.buildStyle();
    if (this.color) fs = fs.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    cells.push(mxVertex({
      id: this.id, value: labelHtml, style: fs,
      parent: this.parentId || '1',
      x: box.x, y: box.y,
      width: box.width - SHADOW_OFFSET, height: box.height - SHADOW_OFFSET,
    }));

    return cells;
  }
}

export function registerCollectionsShape(): void {
  registerRenderer('collections', (desc: RenderDescriptor) => new CollectionsRenderer(desc));
}
