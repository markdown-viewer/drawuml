/**
 * Title renderer — generic diagram title element.
 * Reusable across sequence, class, and other diagram types.
 *
 * measure() returns height INCLUDING a bottom gap so that layout engines
 * can simply place the title's bottom edge at the diagram top — no
 * external TITLE_GAP constant needed.
 */

import { measureText } from '@markdown-viewer/text-measure';
import { Content } from '../shared/content.ts';
import { mxVertex } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import { DEFAULT_FONT_FAMILY, TITLE_FONT_SIZE } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';

const TITLE_BOTTOM_GAP = 20; // gap between title text and diagram content

class TitleRenderer extends Renderer {
  private fontSize: number;
  private htmlLabel: string;
  private textHeight = 0;

  constructor(id: string, text: string, opts?: { fontSize?: number }) {
    super(id);
    this.fontSize = opts?.fontSize ?? TITLE_FONT_SIZE;
    this.htmlLabel = Content.inline(text).html;
  }

  protected doMeasure() {
    const m = measureText(this.htmlLabel, this.fontSize, DEFAULT_FONT_FAMILY, 'bold', 'normal', true);
    this.textHeight = Math.ceil(m.height);
    // Total height includes bottom gap so layout engines don't need a separate constant
    return { width: Math.ceil(m.width), height: this.textHeight + TITLE_BOTTOM_GAP };
  }

  render(box: ContentBox) {
    // Render only the text portion (exclude the bottom gap from the cell)
    const style = `text;html=1;align=center;verticalAlign=middle;fontStyle=1;fontSize=${this.fontSize};`;
    return [mxVertex({
      id: this.id, value: this.htmlLabel, style,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: this.textHeight || box.height,
    })];
  }
}

/** Register title renderer into global registry. */
export function registerTitleRenderer(): void {
  registerRenderer('title', (desc: RenderDescriptor) => {
    return new TitleRenderer(desc.id, desc.label || '');
  });
}
