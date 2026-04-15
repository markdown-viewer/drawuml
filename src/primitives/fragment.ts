/**
 * Fragment (combined frame) primitive for sequence diagrams.
 * Handles alt, loop, opt, group, etc. with sections.
 *
 * Frame style is delegated to buildUmlFrameStyle() (shared with class-diagram frame).
 */

import { mxVertex } from '../shared/xml-utils.ts';
import { normalizeColor } from '../shared/color-utils.ts';
import { TextBlock } from '../shared/text-block.ts';
import { buildUmlFrameStyle } from './shapes/frame.ts';
import { createTheme, fontFamilyStyle, type Theme } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a fragment (umlFrame) with its sections to DrawIO mxCell XML strings.
 * Returns an array of mxCell strings.
 */
export function renderFragment(frag: {
  theme?: Theme;
  id: string;
  type: string;
  label?: string;
  tabLabel?: string;
  tabLabelHtml?: string;
  conditionLabel?: string;
  conditionLabelHtml?: string;
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
    labelHtml?: string;
    y?: number;
    fillColor?: string;
  }>;
}): string[] {
  const cells: string[] = [];
  const tabW = frag.tabWidth || 60;
  const tabH = frag.tabHeight || 20;

  // Build style via shared umlFrame style builder
  const theme = frag.theme ?? createTheme();
  const cornerClip = theme.cornerClip;
  const fontSize = theme.fontSize;
  const sw = theme.strokeWidth;
  const colorDark = theme.colorDark;
  let style = buildUmlFrameStyle({
    tabWidth: tabW, tabHeight: tabH,
    fontSize, cornerClip, strokeWidth: sw,
    fillColor: theme.defaultFill,
    fontColor: colorDark, strokeColor: colorDark,
    fontFamily: theme.fontFamily,
  });
  if (frag.lineColor) {
    const lc = normalizeColor(frag.lineColor);
    style += `fillColor=${lc};strokeColor=${lc};`;
  }
  if (frag.fillColor) style += `swimlaneFillColor=${normalizeColor(frag.fillColor)};`;

  const tabHtml = frag.tabLabelHtml
    || TextBlock.inline(frag.tabLabel || frag.type, { size: fontSize, family: theme.fontFamily }).html;

  cells.push(mxVertex({
    id: frag.id, value: tabHtml, style,
    parent: '1',
    x: frag.x, y: frag.y, width: frag.width, height: frag.height,
  }));

  // Condition label to the right of the tab (or centered in content area for ref)
  const smallFontSize = theme.smallFontSize;
  const labelGap = theme.edgeGap;           // horizontal gap between tab / section line and label text
  const labelSpacingX = theme.edgeGap;      // DrawIO spacingLeft for condition labels
  const sectionSpacingX = theme.contentPad;     // DrawIO spacingLeft for section labels (wider for readability)
  const sectionH = theme.tabH;           // section label cell height

  const isRef = frag.type === 'ref';
  const conditionLabel = frag.conditionLabel || (isRef ? (frag.label || '') : '');
  const conditionHtml = frag.conditionLabelHtml
    || (conditionLabel ? TextBlock.inline(conditionLabel, { size: smallFontSize, family: theme.fontFamily }).html : '');
  if (conditionLabel) {
    const condSize = TextBlock.fromHtml(conditionHtml, { size: smallFontSize, family: theme.fontFamily }).measure();
    const condMinH = theme.tabH;
    const condH = Math.max(condMinH, Math.ceil(condSize.height) + theme.edgeGap);
    if (isRef) {
      // ref: label text centered in content area, no brackets
      const contentY = frag.y + tabH;
      const contentH = frag.height - tabH;
      const labelStyle = `text;html=1;align=center;verticalAlign=middle;fontSize=${smallFontSize};${fontFamilyStyle(theme)}`;
      cells.push(mxVertex({
        id: frag.id + '_label', value: conditionHtml, style: labelStyle,
        parent: '1',
        x: frag.x, y: contentY, width: frag.width, height: contentH,
      }));
    } else {
      const labelStyle = `text;html=1;align=left;verticalAlign=top;spacingLeft=${labelSpacingX};spacingTop=-2;fontSize=${smallFontSize};${fontFamilyStyle(theme)}`;
      cells.push(mxVertex({
        id: frag.id + '_label', value: '[' + conditionHtml + ']', style: labelStyle,
        parent: '1',
        x: frag.x + tabW + labelGap, y: frag.y, width: frag.width - tabW - labelGap * 2, height: condH,
      }));
    }
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
        parent: '1',
        x: frag.x, y, width: frag.width, height: fillH,
      }));
    }

    // Section separator: dashed line + label text
    const lineStyle = `shape=line;strokeWidth=${theme.strokeWidth};strokeColor=${colorDark};dashed=1;dashPattern=5 5;`;
    cells.push(mxVertex({
      id: frag.id + '_sec_line_' + (i + 1), value: '', style: lineStyle,
      parent: '1',
      x: frag.x, y, width: frag.width, height: 1,
    }));
    cells.push(mxVertex({
      id: frag.id + '_sec_' + (i + 1), value: '[' + (section.labelHtml || TextBlock.inline(section.label, { size: smallFontSize, family: theme.fontFamily }).html) + ']',
      style: `text;align=left;verticalAlign=top;spacingLeft=${sectionSpacingX};spacingTop=-2;fontSize=${smallFontSize};${fontFamilyStyle(theme)}`,
      parent: '1',
      x: frag.x + labelGap, y: y + 2, width: frag.width - labelGap * 2, height: sectionH,
    }));
  }

  return cells;
}
