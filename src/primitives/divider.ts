/**
 * Divider primitive for sequence diagrams.
 * Handles three types: ellipsis (spacer), delay (text), section (== text ==).
 */

import { mxVertex, n4 } from '../shared/xml-utils.ts';
import { Content } from '../shared/content.ts';
import type { Theme } from '../shared/theme.ts';

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

  // Delay dividers: plain text, no lines
  if (divider.type === 'delay') {
    const labelHtml = Content.inline(divider.label).html;
    const fontSize = divider.theme?.fontSize ?? 12;
    const divStyle = `text;align=center;verticalAlign=middle;html=1;fontSize=${fontSize};`;
    const hh = divider.halfHeight;
    cells.push(mxVertex({
      id: divider.id, value: labelHtml, style: divStyle,
      parent: '1',
      x: divider.x1, y: divider.y - hh, width: divider.x2 - divider.x1, height: hh * 2,
    }));
    return cells;
  }

  // Section dividers (== text ==): two horizontal lines + bordered text box
  const colorDark = divider.theme?.colorDark ?? '#181818';
  const dividerFill = divider.theme?.dividerFill ?? '#EEEEEE';
  const sw = divider.theme?.strokeWidth ?? 1;
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
  const labelHtml = Content.inline(divider.label).html;
  const hh = divider.halfHeight;
  const largeArcSize = divider.theme?.largeArcSize ?? 12;
  const fontSize = divider.theme?.fontSize ?? 12;
  const boxStyle = `rounded=1;absoluteArcSize=1;arcSize=${largeArcSize};whiteSpace=wrap;html=1;align=center;verticalAlign=middle;fontStyle=1;fontSize=${fontSize};fillColor=${dividerFill};strokeColor=${colorDark};strokeWidth=${n4(sw * 2)};`;
  cells.push(mxVertex({
    id: divider.id, value: labelHtml, style: boxStyle,
    parent: '1',
    x: divider.labelX, y: divider.y - hh, width: divider.labelWidth, height: hh * 2,
  }));

  return cells;
}
