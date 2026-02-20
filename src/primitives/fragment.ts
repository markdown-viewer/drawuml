/**
 * Fragment (combined frame) primitive for sequence diagrams.
 * Handles alt, loop, opt, group, etc. with sections.
 */

import { mxVertex } from '../shared/xml-utils.ts';
import { normalizeColor } from '../shared/color-utils.ts';
import { Content } from '../shared/content.ts';
import { COLOR_DARK, SMALL_FONT_SIZE } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a fragment (umlFrame) with its sections to DrawIO mxCell XML strings.
 * Returns an array of mxCell strings.
 */
export function renderFragment(frag: {
  id: string;
  type: string;
  label?: string;
  tabWidth?: number;
  tabHeight?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  lineColor?: string;
  fillColor?: string;
  sections: Array<{
    label: string;
    y?: number;
    fillColor?: string;
  }>;
}): string[] {
  const cells: string[] = [];

  // For group/partition: tab shows the label text, condition in [brackets] to the right
  // For other types: tab shows the keyword (alt, loop, etc.), label to the right
  const isGroupLike = frag.type === 'group';
  let tabText: string;
  let conditionLabel: string;
  if (isGroupLike) {
    const rawLabel = frag.label || '';
    const bracketMatch = rawLabel.match(/^(.*?)\s*\[(.*)\]\s*$/);
    if (bracketMatch) {
      tabText = bracketMatch[1].trim();
      conditionLabel = bracketMatch[2].trim();
    } else {
      tabText = rawLabel;
      conditionLabel = '';
    }
  } else {
    tabText = frag.type;
    conditionLabel = frag.label || '';
  }
  const tabW = frag.tabWidth || 60;
  const tabH = frag.tabHeight || 20;

  // Build style: apply lineColor as tab fill, fillColor as body background
  let style = `shape=umlFrame;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=-2;corner=7;width=${tabW};height=${tabH};`;
  if (frag.lineColor) style += `fillColor=${normalizeColor(frag.lineColor)};`;
  if (frag.fillColor) style += `swimlaneFillColor=${normalizeColor(frag.fillColor)};`;

  // Convert raw Creole labels to HTML
  const tabHtml = Content.inline(tabText).html;

  cells.push(mxVertex({
    id: frag.id, value: tabHtml, style,
    x: frag.x, y: frag.y, width: frag.width, height: frag.height,
  }));

  // Condition label to the right of the tab
  if (conditionLabel) {
    const condHtml = Content.inline(conditionLabel).html;
    const labelStyle = `text;html=1;align=left;verticalAlign=top;spacingLeft=4;spacingTop=-2;fontSize=${SMALL_FONT_SIZE};`;
    cells.push(mxVertex({
      id: frag.id + '_label', value: '[' + condHtml + ']', style: labelStyle,
      x: frag.x + tabW + 4, y: frag.y, width: frag.width - tabW - 8, height: 20,
    }));
  }

  // Sections: separator lines + labels + optional fill rects
  for (let i = 0; i < frag.sections.length; i += 1) {
    const section = frag.sections[i];
    const y = section.y ?? frag.y;

    // Section background fill rect (if fillColor is specified)
    if (section.fillColor) {
      const nextY = (i + 1 < frag.sections.length)
        ? (frag.sections[i + 1].y ?? frag.y)
        : (frag.y + frag.height);
      const fillH = nextY - y;
      const secFill = normalizeColor(section.fillColor);
      cells.push(mxVertex({
        id: frag.id + '_sec_bg_' + (i + 1), value: '', style: `fillColor=${secFill};strokeColor=none;`,
        x: frag.x, y, width: frag.width, height: fillH,
      }));
    }

    // Section separator: dashed line + label text
    const lineStyle = `shape=line;strokeWidth=1;strokeColor=${COLOR_DARK};dashed=1;dashPattern=5 5;`;
    cells.push(mxVertex({
      id: frag.id + '_sec_line_' + (i + 1), value: '', style: lineStyle,
      x: frag.x, y, width: frag.width, height: 1,
    }));
    cells.push(mxVertex({
      id: frag.id + '_sec_' + (i + 1), value: '[' + Content.inline(section.label).html + ']',
      style: `text;align=left;verticalAlign=top;spacingLeft=8;spacingTop=-2;fontSize=${SMALL_FONT_SIZE};`,
      x: frag.x + 4, y: y + 2, width: frag.width - 8, height: 20,
    }));
  }

  return cells;
}
