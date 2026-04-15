/**
 * Title renderer — generic diagram title element.
 * Reusable across sequence, class, and other diagram types.
 *
 * measure() returns height INCLUDING a bottom gap so that layout engines
 * can simply place the title's bottom edge at the diagram top — no
 * external TITLE_GAP constant needed.
 */

import { TextBlock } from '../shared/text-block.ts';
import { mxVertex } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import type { Theme } from '../shared/theme.ts';
import { fontFamilyStyle } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content-types.ts';

class TitleRenderer extends Renderer {
  private fontSize: number;
  private textBlock: TextBlock;
  private textHeight = 0;

  constructor(id: string, text: string, opts?: { fontSize?: number; theme?: Theme; html?: string }) {
    super(id, opts?.theme);
    this.fontSize = opts?.fontSize ?? this.theme.titleFontSize;
    this.textBlock = opts?.html
      ? TextBlock.fromHtml(opts.html, {
        size: this.fontSize,
        family: this.theme.fontFamily,
        weight: 'bold',
      })
      : TextBlock.inline(text, {
        size: this.fontSize,
        family: this.theme.fontFamily,
        weight: 'bold',
      });
  }

  protected doMeasure() {
    const m = this.textBlock.measure();
    this.textHeight = Math.ceil(m.height);
    // Total height includes bottom gap so layout engines don't need a separate constant
    return { width: Math.ceil(m.width), height: this.textHeight + this.theme.nodeGap };
  }

  render(box: ContentBox) {
    // Render only the text portion (exclude the bottom gap from the cell)
    const style = `text;html=1;align=center;verticalAlign=middle;fontStyle=1;fontSize=${this.fontSize};${fontFamilyStyle(this.theme)}`;
    return [mxVertex({
      id: this.id, value: this.textBlock.html, style,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: this.textHeight || box.height,
    })];
  }
}

/** Register title renderer into global registry. */
export function registerTitleRenderer(): void {
  registerRenderer('title', (desc: RenderDescriptor) => {
    return new TitleRenderer(desc.id, desc.label || '', { theme: desc.theme, html: desc.labelHtml });
  });
}
