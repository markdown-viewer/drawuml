/**
 * Person shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `mxgraph.c4.person2` shape (circle head + rounded body).
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class PersonRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.c4.person2;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.spacingTop)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};whiteSpace=wrap;`;
  }
  // Compute top padding to match the mxgraph.c4.person2 stencil head area.
  // Stencil draws head circle of diameter d = 0.45 * min(w, h), body starts
  // at y = 0.8 * d, so label top = 0.36 * min(cellW, cellH).
  // We solve: contentPad + padTop = 0.36 * min(cw, ch + padTop)
  // where cw = contentSize.width, ch = contentSize.height.
  protected shapePadding(contentSize?: { width: number; height: number }): ShapePadding {
    if (!contentSize) return {};
    const cp = this.contentPad;
    const cw = contentSize.width;
    const ch = contentSize.height;
    const R = 0.8 * 0.45; // 0.36 — stencil ratio
    // Case 1: cellW <= cellH  →  padTop = R * cw - cp
    const pt1 = R * cw - cp;
    if (pt1 >= 0 && cw <= ch + pt1) {
      return { top: pt1 };
    }
    // Case 2: cellH < cellW  →  padTop = (R * ch - cp) / (1 - R)
    const pt2 = (R * ch - cp) / (1 - R);
    return { top: Math.max(0, pt2) };
  }
  get isCluster(): boolean { return false; }
}

export function registerPersonShape(): void {
  registerRenderer('person', (desc: RenderDescriptor) => new PersonRenderer(desc));
}
