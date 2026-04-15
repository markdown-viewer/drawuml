/**
 * Divider primitive for sequence diagrams.
 * Handles three types: ellipsis (spacer), delay (text), section (== text ==).
 */

import { mxVertex, n4 } from '../shared/xml-utils.ts';
import { TextBlock } from '../shared/text-block.ts';
import { createTheme, fontFamilyStyle, type Theme } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a divider to DrawIO mxCell XML strings.
 * Returns an array of mxCell strings (empty for ellipsis type).
 */
export function renderDivider(divider: {
  theme?: Theme;
  id: string;
  type: string;
  label: string;
  labelHtml?: string;
  x1: number;
  x2: number;
  y: number;
  halfHeight: number;
  labelX?: number;
  labelWidth?: number;
}): string[] {
  // Ellipsis (...) are invisible spacers — only occupy a row
  if (divider.type === 'ellipsis') return [];

  const cells: string[] = [];
  const theme = divider.theme ?? createTheme();
  const fontSize = theme.fontSize;

  // Delay dividers: plain text, no lines — render at label size, not full span
  if (divider.type === 'delay') {
    const labelHtml = divider.labelHtml || TextBlock.inline(divider.label, { size: fontSize, family: theme.fontFamily }).html;
    const divStyle = `text;align=center;verticalAlign=middle;html=1;fontSize=${fontSize};${fontFamilyStyle(theme)}`;
    const hh = divider.halfHeight;
    const lx = divider.labelX ?? divider.x1;
    const lw = divider.labelWidth ?? (divider.x2 - divider.x1);
    cells.push(mxVertex({
      id: divider.id, value: labelHtml, style: divStyle,
      parent: '1',
      x: lx, y: divider.y - hh, width: lw, height: hh * 2,
    }));
    return cells;
  }

  // Section dividers (== text ==): two horizontal lines + bordered text box
  const colorDark = theme.colorDark;
  const dividerFill = theme.dividerFill;
  const sw = theme.strokeWidth;
  const lineY1 = divider.y - 1;
  const lineY2 = divider.y + 2;
  cells.push(mxVertex({
    id: divider.id + '_line1', value: '', style: `shape=line;strokeWidth=${sw};strokeColor=${colorDark};`,
    parent: '1',
    x: divider.x1, y: lineY1, width: divider.x2 - divider.x1, height: 1,
  }));
  cells.push(mxVertex({
    id: divider.id + '_line2', value: '', style: `shape=line;strokeWidth=${sw};strokeColor=${colorDark};`,
    parent: '1',
    x: divider.x1, y: lineY2, width: divider.x2 - divider.x1, height: 1,
  }));
  // Bordered text box centered between the lines
  const labelHtml = divider.labelHtml || TextBlock.inline(divider.label, { size: fontSize, family: theme.fontFamily, weight: 'bold' }).html;
  const hh = divider.halfHeight;
  const boxStyle = `rounded=0;whiteSpace=nowrap;html=1;align=center;verticalAlign=middle;fontStyle=1;fontSize=${fontSize};fillColor=${dividerFill};strokeColor=${colorDark};strokeWidth=${n4(sw * 2)};${fontFamilyStyle(theme)}`;
  cells.push(mxVertex({
    id: divider.id, value: labelHtml, style: boxStyle,
    parent: '1',
    x: divider.labelX, y: divider.y - hh, width: divider.labelWidth, height: hh * 2,
  }));

  return cells;
}
