/**
 * Note primitive — sizing, style & rendering.
 * Used by both sequence-diagram and class-diagram via NoteNodeRenderer.
 *
 * Content processing is delegated to the shared Content module.
 * This file provides:
 *   - noteStyle(noteType, fillColor) — generate DrawIO note shape style
 *   - NoteNodeRenderer — extends RichRenderer with rich body mode
 */

import { richTextStyle } from '../../shared/content.ts';
import { normalizeColor, darkenColor } from '../../shared/color-utils.ts';
import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

// ---------------------------------------------------------------------------
// Note sizing constants
// ---------------------------------------------------------------------------
const NOTE_PADDING_V = 5;        // vertical padding each side
const NOTE_H_PAD_EXTRA = 8;      // extra horizontal padding beyond spacing
const NOTE_MIN_WIDTH = 30;

/** Horizontal padding per note shape type (spacingLeft + spacingRight + extra). */
function noteHPadding(noteType: string, contentPadX: number): number {
  if (noteType === 'hnote') return 15 + 10 + NOTE_H_PAD_EXTRA;  // hexagon
  if (noteType === 'rnote') return 5 + 0 + NOTE_H_PAD_EXTRA;    // rounded rect
  return contentPadX;                                           // default note
}

// ---------------------------------------------------------------------------
// Note DrawIO style
// ---------------------------------------------------------------------------

/**
 * Return the DrawIO mxCell style string for a note shape.
 * `fillColor` defaults to PlantUML's note yellow (#FEFFDD).
 */
export function noteStyle(noteType = 'note', fillColor = '#FEFFDD'): string {
  const fill = normalizeColor(fillColor);
  const stroke = darkenColor(fill);
  if (noteType === 'hnote') {
    return `shape=hexagon;whiteSpace=wrap;html=1;align=left;spacingLeft=15;spacingRight=10;fillColor=${fill};strokeColor=${stroke};perimeter=hexagonPerimeter2;fixedSize=1;size=10;`;
  }
  if (noteType === 'rnote') {
    return `rounded=0;whiteSpace=wrap;html=1;align=left;spacingLeft=5;fillColor=${fill};strokeColor=${stroke};`;
  }
  return `shape=note;size=10;whiteSpace=wrap;html=1;align=left;spacingLeft=5;spacingRight=10;fillColor=${fill};strokeColor=${stroke};`;
}

/** Separator style inside notes. */
function noteSepStyle(): string {
  return [
    'line', 'strokeWidth=1', 'align=left', 'verticalAlign=middle',
    'spacingTop=-1', 'spacingLeft=3', 'spacingRight=3',
    'rotatable=0', 'labelPosition=right', 'points=[]',
  ].join(';') + ';';
}

/** Text row style inside notes. */
function noteTextStyle(): string {
  return richTextStyle(5, 10);
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class NoteNodeRenderer extends RichRenderer {
  constructor(desc: RenderDescriptor) {
    super(desc);
  }

  private get noteType(): string { return this.desc.noteType || 'note'; }
  private get fillColor(): string { return normalizeColor(this.desc.color || '#FEFFDD'); }

  get isCluster(): boolean { return false; }

  // Note always uses rich body mode (desc.lines as content)
  protected detectRichBody(): boolean { return true; }
  protected getRichBodyLines(): string[] { return this.desc.lines || []; }

  protected getRichBodyMetrics(): Record<string, number> {
    return {
      paddingX: noteHPadding(this.noteType, this.theme.contentPadX),
      paddingY: this.theme.contentPadY,
      minWidth: NOTE_MIN_WIDTH,
    };
  }

  // Note style is a complete container style (no fragment extraction needed)
  protected get richBodyStyleComplete(): boolean { return true; }

  protected buildStyle(): string {
    return noteStyle(this.noteType, this.fillColor);
  }

  // Note doesn't use deployment shape color override — color is baked into style
  protected applyColorOverride(s: string): string { return s; }

  protected getRichBodyRowStyle(): string { return noteTextStyle(); }
  protected getRichBodySepStyle(): string { return noteSepStyle(); }
}

/** Register note renderer into global registry. */
export function registerNoteRenderer(): void {
  registerRenderer('note', (desc: RenderDescriptor) => new NoteNodeRenderer(desc));
}
