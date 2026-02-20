/**
 * Shared label HTML builder — produces HTML content for node/participant titles
 * with optional stereotype text, spot circle, and italic styling.
 * Used by class-node.ts (buildTitleHtml) and participant.ts (buildParticipantLabel).
 */

import { escapeXml } from '../shared/xml-utils.ts';
import { darkenColor } from '../shared/color-utils.ts';

const SPOT_SIZE = 22;  // spot circle diameter (px)

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
}): string {
  const { label, stereotypeLabel, spot, italic = false, stereotypePosition = 'top' } = opts;

  const hasStereotype = Boolean(stereotypeLabel);
  const hasSpot = Boolean(spot);
  const styledLabel = italic ? `<i>${label}</i>` : label;

  if (!hasStereotype && !hasSpot) {
    return styledLabel;
  }

  // Escape stereotype text for HTML context (e.g. "<< Generated >>" must not be parsed as tags)
  const stereoText = hasStereotype ? escapeXml(stereotypeLabel!) : '';
  const stereoDiv = hasStereotype
    ? `<div style="font-size:12px;font-style:italic;line-height:1.3;">${stereoText}</div>`
    : '';

  if (!hasSpot) {
    return stereotypePosition === 'bottom'
      ? `<div>${styledLabel}</div>` + stereoDiv
      : stereoDiv + `<div>${styledLabel}</div>`;
  }

  // Spot circle HTML
  const borderColor = darkenColor(spot!.color);
  const circleHtml =
    `<span style="display:inline-block;width:${SPOT_SIZE}px;height:${SPOT_SIZE}px;line-height:${SPOT_SIZE}px;`
    + `text-align:center;border-radius:50%;background:${spot!.color};`
    + `border:1px solid ${borderColor};`
    + `font-size:14px;font-style:normal;font-weight:bold;vertical-align:middle;`
    + `margin-right:4px;">${spot!.char}</span>`;

  if (!hasStereotype) {
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
