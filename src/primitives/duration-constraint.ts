/**
 * Duration constraint primitive for sequence diagrams.
 * Renders a vertical arrow line with an optional label.
 */

import { escapeXml, mxVertex, cellId, n4 } from '../shared/xml-utils.ts';
import { TextBlock } from '../shared/text-block.ts';
import { createTheme, fontFamilyStyle, type Theme } from '../shared/theme.ts';

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
  const theme = dc.theme ?? createTheme();
  const colorDark = theme.colorDark;
  const smallFontSize = theme.smallFontSize;
  const sw = theme.strokeWidth;
  const lineStyle = `endArrow=block;endFill=1;startArrow=block;startFill=1;strokeColor=${colorDark};strokeWidth=${sw};`;
  cells.push(
    `<mxCell id="${escapeXml(cellId(dc.id + '_line'))}" value="" style="${lineStyle}" edge="1" parent="1">`
    + `<mxGeometry relative="1" as="geometry">`
    + `<mxPoint x="${n4(dc.x)}" y="${n4(dc.y1)}" as="sourcePoint"/>`
    + `<mxPoint x="${n4(dc.x)}" y="${n4(dc.y2)}" as="targetPoint"/>`
    + `</mxGeometry>`
    + `</mxCell>`
  );
  if (dc.label) {
    // Convert raw Creole label to HTML
    const labelHtml = TextBlock.inline(dc.label, { size: smallFontSize, family: theme.fontFamily }).html;
    const lineH = dc.y2 - dc.y1;
    const labelH = Math.ceil(smallFontSize + theme.padXS);
    const labelY = dc.y1 + lineH / 2 - labelH / 2;
    const labelStyle = `text;html=1;align=left;verticalAlign=middle;whiteSpace=nowrap;fontSize=${smallFontSize};${fontFamilyStyle(theme)}`;
    cells.push(mxVertex({
      id: dc.id + '_label', value: labelHtml, style: labelStyle,
      parent: '1',
      x: dc.labelX, y: labelY, width: dc.labelWidth, height: labelH,
    }));
  }
  return cells;
}
