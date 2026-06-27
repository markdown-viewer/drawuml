/**
 * Packetdiag DrawIO XML generator.
 *
 * Converts a PacketdiagModel with layout coordinates into a complete DrawIO mxfile XML string.
 * Renders: bit-scale header, field rectangles (via renderers).
 */

import type { PacketdiagModel, PacketdiagLayoutResult } from '../model/packetdiag-model.ts';
import type { Renderer } from '../primitives/renderer.ts';
import type { Theme } from '../shared/theme.ts';
import { mxVertex, wrapMxfile, escapeXml, cellId, n4 } from '../shared/xml-utils.ts';

export function packetdiagToDrawioXml(
  model: PacketdiagModel,
  layout: PacketdiagLayoutResult,
  renderers: Map<string, Renderer>,
  theme: Theme,
): string {
  const cells: string[] = [];
  cells.push('<mxCell id="0"/>');
  cells.push('<mxCell id="1" parent="0"/>');

  // 1. Render bit-scale header (ticks + labels)
  renderScaleHeader(cells, layout, theme);

  // 2. Render each field (via renderers)
  for (const lf of layout.fields) {
    const renderer = renderers.get(lf.id);
    if (!renderer) continue;
    const box = { x: lf.x, y: lf.y, width: lf.w, height: lf.h };
    cells.push(...renderer.render(box));
  }

  // Compute page size from layout
  const pageW = layout.totalWidth;
  const pageH = layout.totalHeight;

  return wrapMxfile(cells, { pageWidth: pageW, pageHeight: pageH });
}

// ── Scale header ────────────────────────────────────────────────────────────

/** Render the bit-scale ruler at the top of the diagram. */
function renderScaleHeader(
  cells: string[],
  layout: PacketdiagLayoutResult,
  theme: Theme,
): void {
  const { colwidth, maxBitsPerRow, scaleDirection } = layout;
  const t = theme;
  const scaleH = t.sizeL;
  const tickShort = t.sizeXS;
  const tickMed   = t.sizeS;
  const tickLong  = t.sizeS;
  const labelH = scaleH - tickLong;
  const lineW = t.strokeWidth;
  const rtl = scaleDirection === 'rtl';
  const labelEvery = maxBitsPerRow > 16 ? 16 : 8;
  const labelW = Math.round(t.fontSize * 1.75);
  const labelXOff = Math.round(labelW / 2);

  for (let bit = 0; bit <= maxBitsPerRow; bit++) {
    const x = bit * colwidth;

    let tickH: number;
    if (bit % 8 === 0) {
      tickH = tickLong;
    } else if (bit % 4 === 0) {
      tickH = tickMed;
    } else {
      tickH = tickShort;
    }

    const y1 = scaleH - tickH;
    const y2 = scaleH;

    // Tick mark as a line (edge with sourcePoint/targetPoint, no fill)
    cells.push(
      `<mxCell id="${escapeXml(cellId(`pkt-tick-${bit}`))}" value="" style="html=1;strokeColor=${theme.colorDark};strokeWidth=${lineW};endArrow=none;startArrow=none;" edge="1" parent="${escapeXml(cellId('1'))}">`
      + `<mxGeometry relative="1" as="geometry">`
      + `<mxPoint x="${n4(x)}" y="${n4(y1)}" as="sourcePoint"/>`
      + `<mxPoint x="${n4(x)}" y="${n4(y2)}" as="targetPoint"/>`
      + `</mxGeometry>`
      + `</mxCell>`,
    );

    // Bit number label (only at labelEvery multiples)
    if (bit % labelEvery === 0) {
      // rtl: reverse label numbers (16,8,0 instead of 0,8,16)
      const labelBit = rtl ? maxBitsPerRow - bit : bit;
      cells.push(mxVertex({
        id: `pkt-tick-lbl-${bit}`,
        value: String(labelBit),
        style: `text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=bottom;fontSize=${theme.smallFontSize};fontFamily=${theme.fontFamily};fontColor=${theme.fontColor};`,
        parent: '1',
        x: x - labelXOff,
        y: 0,
        width: labelW,
        height: labelH,
      }));
    }
  }
}
