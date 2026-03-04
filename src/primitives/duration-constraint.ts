/**
 * Duration constraint primitive for sequence diagrams.
 * Renders a vertical arrow line with an optional label.
 */

import { escapeXml, mxVertex, cellId } from '../shared/xml-utils.ts';
import { Content } from '../shared/content.ts';
import type { Theme } from '../shared/theme.ts';

/**
 * Render a duration constraint (vertical line with arrows + label) to DrawIO mxCell XML strings.
 * Returns an array of mxCell strings.
 */
export function renderDurationConstraint(dc: {
  theme?: Theme;
  id: string;
  x: number;
  y1: number;
  y2: number;
  label?: string;
  labelX?: number;
  labelWidth?: number;
}): string[] {
  const cells: string[] = [];
  const colorDark = dc.theme?.colorDark ?? '#181818';
  const smallFontSize = dc.theme?.smallFontSize ?? 10;
  const sw = dc.theme?.strokeWidth ?? 1;
  const lineStyle = `endArrow=block;endFill=1;startArrow=block;startFill=1;strokeColor=${colorDark};strokeWidth=${sw};`;
  cells.push(
    `<mxCell id="${escapeXml(cellId(dc.id + '_line'))}" value="" style="${lineStyle}" edge="1" parent="1">`
    + `<mxGeometry relative="1" as="geometry">`
    + `<mxPoint x="${dc.x}" y="${dc.y1}" as="sourcePoint"/>`
    + `<mxPoint x="${dc.x}" y="${dc.y2}" as="targetPoint"/>`
    + `</mxGeometry>`
    + `</mxCell>`
  );
  if (dc.label) {
    // Convert raw Creole label to HTML
    const labelHtml = Content.inline(dc.label).html;
    const lineH = dc.y2 - dc.y1;
    const labelY = dc.y1 + lineH / 2 - 7;
    const labelStyle = `text;html=1;align=left;verticalAlign=middle;whiteSpace=nowrap;fontSize=${smallFontSize};`;
    cells.push(mxVertex({
      id: dc.id + '_label', value: labelHtml, style: labelStyle,
      parent: '1',
      x: dc.labelX, y: labelY, width: dc.labelWidth, height: 14,
    }));
  }
  return cells;
}
