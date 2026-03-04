/**
 * Message arrow primitive — style generation for sequence diagram arrows.
 */

import { n4 } from '../shared/xml-utils.ts';

// ---------------------------------------------------------------------------
// Message style
// ---------------------------------------------------------------------------

/**
 * Generate the DrawIO edge style string for a sequence message arrow.
 * Input `msg` should carry arrowStyle, exitX, entryX, fromRelY, toRelY.
 */
export function messageStyle(msg: any, strokeWidth?: number): string {
  const arrowStyle = msg && msg.arrowStyle ? msg.arrowStyle : null;
  const dashed = arrowStyle && arrowStyle.lineStyle === 'dashed' ? 1 : 0;

  let endArrow = 'classic';
  let endFill = 1;
  let startArrow = 'none';
  let startFill = 0;

  // Use arrowHead from parsed style if available
  const ah = arrowStyle ? arrowStyle.arrowHead : 'filled';
  // For half arrows: single char (\, /) = filled, double (\\, //) = open
  const visibleHeadToken = arrowStyle
    ? (arrowStyle.direction === 'left'
      ? (arrowStyle.startHeadToken || arrowStyle.endHeadToken || '')
      : (arrowStyle.endHeadToken || arrowStyle.startHeadToken || ''))
    : '';
  // Strip decorator chars (o, x) and boundary markers ([, ], ?) before checking if head is double (open)
  const headForFill = visibleHeadToken.replace(/^[\[?]/, '').replace(/[\]?]$/, '').replace(/^[ox]/, '').replace(/[ox]$/, '');
  const isDoubleHead = /^(\\\\|\/\/|>>|<<)/.test(headForFill);

  if (ah === 'open') {
    endArrow = 'open';
    endFill = 0;
  } else if (ah === 'cross') {
    endArrow = 'cross';
    endFill = 0;
  } else if (ah === 'half_bottom') {
    endArrow = 'halfBottom';
    endFill = isDoubleHead ? 0 : 1;
  } else if (ah === 'half_top') {
    endArrow = 'halfTop';
    endFill = isDoubleHead ? 0 : 1;
  } else if (ah === 'circle') {
    endArrow = 'oval';
    endFill = 0;
  } else {
    // 'filled' or default
    endArrow = 'classic';
    endFill = 1;
  }

  // Bidirectional: add startArrow matching endArrow
  if (arrowStyle && arrowStyle.bidirectional) {
    startArrow = endArrow;
    startFill = endFill;
  }

  // Map decorators to drawio arrow sides.
  const dir = arrowStyle ? arrowStyle.direction : 'right';
  const rawStartDec = arrowStyle ? arrowStyle.startDecorator : 'none';
  const rawEndDec = arrowStyle ? arrowStyle.endDecorator : 'none';
  const sourceDec = dir === 'left' ? rawEndDec : rawStartDec;
  const targetDec = dir === 'left' ? rawStartDec : rawEndDec;

  // Target decorator: affects endArrow (at target/receiver side)
  if (targetDec === 'circle') {
    endArrow = endArrow + 'Dot';
  } else if (targetDec === 'cross') {
    endArrow = 'cross';
    endFill = 0;
  }

  // Source decorator: affects startArrow (at source/sender side)
  if (sourceDec === 'circle') {
    if (startArrow !== 'none') {
      startArrow = startArrow + 'Dot';
    } else {
      startArrow = 'oval';
      startFill = 1;
    }
  } else if (sourceDec === 'cross') {
    startArrow = 'cross';
    startFill = 0;
  }

  const parts = [
    `dashed=${dashed}`,
    `endArrow=${endArrow}`,
    `endFill=${endFill}`,
    `startArrow=${startArrow}`,
    `startFill=${startFill}`,
    'align=left',
    'labelBackgroundColor=none',
    'curved=0',
    'rounded=0',
    'edgeStyle=none',
    'orthogonalLoop=1',
    'jettySize=auto',
    'sourcePerimeterSpacing=0',
    'targetPerimeterSpacing=0',
    `exitX=${Number.isFinite(msg?.exitX) ? n4(msg.exitX) : '0.5'}`,
    `exitY=${Number.isFinite(msg?.fromRelY) ? n4(msg.fromRelY) : '0.5'}`,
    `entryX=${Number.isFinite(msg?.entryX) ? n4(msg.entryX) : '0.5'}`,
    `entryY=${Number.isFinite(msg?.toRelY) ? n4(msg.toRelY) : '0.5'}`,
  ];

  // Stroke width from theme
  if (strokeWidth != null) parts.push(`strokeWidth=${strokeWidth}`);

  // Arrow color from [#color] syntax
  if (arrowStyle && arrowStyle.color) {
    const c = arrowStyle.color;
    const color = /^[0-9a-fA-F]+$/.test(c) ? '#' + c : c;
    parts.push(`strokeColor=${color}`);
  }

  return parts.join(';') + ';';
}
