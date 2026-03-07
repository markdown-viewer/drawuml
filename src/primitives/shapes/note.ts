/**
 * Note shape renderer — standalone note node.
 *
 * Supports three note variants: note (fold corner), hnote (hexagon), rnote (rectangle).
 * Uses standard RichRenderer content layout — only shape and color differ.
 */

import { normalizeColor, darkenColor } from '../../shared/color-utils.ts';
import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import type { SeparatorBoundsFn } from '../../shared/content-types.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class NoteNodeRenderer extends RichRenderer {
  private get noteType(): string { return this.desc.noteType || 'note'; }
  private get fillColor(): string { return normalizeColor(this.desc.color || '#FEFFDD'); }

  // Note always uses rich body mode (desc.lines as content)
  protected detectRichBody(): boolean { return true; }
  protected getRichBodyLines(): string[] { return this.desc.lines || []; }

  protected buildStyle(): string {
    const fill = this.fillColor;
    const stroke = darkenColor(fill);
    const clip = this.theme.cornerClip;
    const fs = this.theme.fontSize;
    const ff = this.theme.fontFamily;
    const sw = this.theme.strokeWidth;
    const base = `whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};strokeWidth=${sw};fontSize=${fs};fontFamily=${ff};`;
    if (this.noteType === 'hnote') {
      return `shape=hexagon;perimeter=hexagonPerimeter2;fixedSize=1;size=${clip};${base}`;
    }
    if (this.noteType === 'rnote') {
      return `rounded=0;${base}`;
    }
    return `shape=note;size=${clip};${base}`;
  }

  // Shape-specific content avoidance padding:
  // - note (fold corner): avoid the fold triangle on the right
  // - hnote (hexagon): avoid pointed sides on both left and right
  // - rnote (rectangle): no extra padding needed
  protected shapePadding(): ShapePadding {
    const clip = this.theme.cornerClip;
    if (this.noteType === 'hnote') {
      return { left: clip, right: clip };
    }
    if (this.noteType === 'note') {
      return { right: clip };
    }
    return {};
  }

  // Separator lines span the full width regardless of shapePadding
  protected separatorBounds(boxW: number, _boxH: number): SeparatorBoundsFn | undefined {
    return () => ({ x: 0, width: boxW });
  }
}

/** Register note renderer into global registry. */
export function registerNoteRenderer(): void {
  registerRenderer('note', (desc: RenderDescriptor) => new NoteNodeRenderer(desc));
}