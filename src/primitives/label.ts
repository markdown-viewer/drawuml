/**
 * Shared label HTML builder — produces HTML content for node/participant titles
 * with optional stereotype text, spot circle, and italic styling.
 * Used by class-node.ts (buildTitleHtml) and participant.ts (buildParticipantLabel).
 */

import { escapeXml } from '../shared/xml-utils.ts';
import { darkenColor } from '../shared/color-utils.ts';

/**
 * Build HTML label content with optional stereotype, spot circle, and italic styling.
 * Returns raw HTML string — callers should escapeXml() for mxCell value attributes.
 */
export function buildLabelHtml(opts: {
  label: string;
  stereotypeLabel?: string;
  spot?: { char: string; color: string };
  italic?: boolean;
  stereotypePosition?: 'top' | 'bottom';
  fontSize?: number;
  spotSize?: number;
  spotFontSize?: number;
  spotMargin?: number;
}): string {
  const { label, stereotypeLabel, spot, italic = false, stereotypePosition = 'top', fontSize } = opts;
  const fs = fontSize ?? 12;

  const hasStereotype = Boolean(stereotypeLabel);
  const hasSpot = Boolean(spot);
  const styledLabel = italic ? `<i>${label}</i>` : label;

  if (!hasStereotype && !hasSpot) {
    return styledLabel;
  }

  // Derive sizes from base font size
  const stereoFontSize = fs;
  // Escape stereotype text for HTML context (e.g. "<< Generated >>" must not be parsed as tags)
  const stereoText = hasStereotype ? escapeXml(stereotypeLabel!) : '';
  const stereoDiv = hasStereotype
    ? `<div style="font-size:${stereoFontSize}px;font-style:italic;line-height:1.3;">${stereoText}</div>`
    : '';

  if (!hasSpot) {
    return stereotypePosition === 'bottom'
      ? `<div>${styledLabel}</div>` + stereoDiv
      : stereoDiv + `<div>${styledLabel}</div>`;
  }

  // Spot circle HTML — sizes from theme or derived from font size
  const spotSize = opts.spotSize ?? fs * 20 / 12;     // = theme.sizeS
  const spotFont = opts.spotFontSize ?? fs * 14 / 12;  // ≈ theme.spotFontSize
  const spotMar = opts.spotMargin ?? fs * 5 / 12;      // = theme.padXS
  const borderColor = darkenColor(spot!.color);
  const circleHtml =
    `<span style="display:inline-block;width:${spotSize}px;height:${spotSize}px;line-height:${spotSize}px;`
    + `text-align:center;border-radius:50%;background:${spot!.color};`
    + `border:1px solid ${borderColor};`
    + `font-size:${spotFont}px;font-style:normal;font-weight:bold;vertical-align:middle;`
    + `margin-right:${spotMar}px;">${spot!.char}</span>`;

  if (!hasStereotype) {
    // When label is multi-line, wrap in alignment span so the spot circle
    // is vertically centered with the entire title block (not just the first line).
    if (styledLabel.includes('<br')) {
      return circleHtml
        + '<span style="display:inline-block;vertical-align:middle;text-align:center;">'
        + styledLabel
        + '</span>';
    }
    return circleHtml + styledLabel;
  }

  const innerHtml = stereotypePosition === 'bottom'
    ? `<div>${styledLabel}</div>` + stereoDiv
    : stereoDiv + `<div>${styledLabel}</div>`;

  return circleHtml
    + '<span style="display:inline-block;vertical-align:middle;text-align:center;">'
    + innerHtml
    + '</span>';
}
