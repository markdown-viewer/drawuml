/**
 * Note primitive — sizing, style & rendering.
 * Used by both sequence-diagram and class-diagram via NoteNodeRenderer.
 *
 * Content processing is delegated to the shared Content module.
 * This file provides:
 *   - createNoteRenderer(id, rawLines, opts) — factory returning Renderer
 *   - noteStyle(noteType, fillColor) — generate DrawIO note shape style
 */

import { Content, richTextStyle } from '../shared/content.ts';
import { normalizeColor, darkenColor } from '../shared/color-utils.ts';
import { RichBodyRenderer } from './renderer.ts';
import { CONTENT_PAD_X, CONTENT_PAD_Y } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { NoteRendererOpts } from './renderer.ts';
import type { ContentBox } from '../shared/content.ts';

// ---------------------------------------------------------------------------
// Note sizing constants
// ---------------------------------------------------------------------------
const NOTE_PADDING_V = 5;        // vertical padding each side
const NOTE_H_PAD_EXTRA = 8;      // extra horizontal padding beyond spacing
const NOTE_MIN_WIDTH = 30;
const NOTE_MIN_HEIGHT = 28;

/** Horizontal padding per note shape type (spacingLeft + spacingRight + extra). */
function noteHPadding(noteType: string): number {
  if (noteType === 'hnote') return 15 + 10 + NOTE_H_PAD_EXTRA;  // hexagon
  if (noteType === 'rnote') return 5 + 0 + NOTE_H_PAD_EXTRA;    // rounded rect
  return CONTENT_PAD_X;                                          // default note
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

/** Separator style inside notes (same structure as bracket-node). */
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

class NoteNodeRenderer extends RichBodyRenderer {
  constructor(
    id: string,
    rawLines: string[],
    opts?: NoteRendererOpts,
  ) {
    super(id);
    const nt = opts?.noteType || 'note';
    const fill = normalizeColor(opts?.color || '#FEFFDD');
    this.fillColor = fill;
    this.strokeColor = darkenColor(fill);
    this.style = noteStyle(nt, fill);
    this.content = Content.richBody(rawLines, {
      paddingX: noteHPadding(nt),
      paddingY: CONTENT_PAD_Y,
      minWidth: NOTE_MIN_WIDTH,
      minHeight: NOTE_MIN_HEIGHT,
    });
  }

  protected getRowStyle() { return noteTextStyle(); }
  protected getSeparatorStyle() { return noteSepStyle(); }
}

/** Register note renderer into global registry. */
export function registerNoteRenderer(): void {
  registerRenderer('note', (desc: RenderDescriptor) => {
    return new NoteNodeRenderer(desc.id, desc.lines || [], {
      noteType: desc.noteType,
      color: desc.color,
    });
  });
}
