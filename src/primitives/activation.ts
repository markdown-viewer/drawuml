/**
 * Activation bar & destroy marker primitives for sequence diagrams.
 */

import { mxVertex } from '../shared/xml-utils.ts';
import { normalizeColor, darkenColor } from '../shared/color-utils.ts';
import { createTheme, type Theme } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Destroy marker
// ---------------------------------------------------------------------------

/**
 * Render a destroy marker (X cross) to a DrawIO mxCell XML string.
 * When parentId + parentGeom are provided, coordinates are relative to the parent.
 */
export function renderDestroyMarker(
  id: string,
  cx: number,
  cy: number,
  parentId?: string,
  parentGeom?: { x: number; y: number },
  theme: Theme = createTheme(),
): string {
  const s = theme.portSize;
  const destroyStroke = theme.destroyStroke;
  const destroyStyle = `shape=umlDestroy;strokeColor=${destroyStroke};strokeWidth=${theme.boldStrokeWidth};`;
  if (parentId && parentGeom) {
    const relX = cx - s - parentGeom.x;
    const relY = cy - s - parentGeom.y;
    return mxVertex({
      id, value: '', style: destroyStyle, parent: parentId,
      x: relX, y: relY, width: s * 2, height: s * 2,
    });
  }
  return mxVertex({
    id, value: '', style: destroyStyle,
    parent: '1',
    x: cx - s, y: cy - s, width: s * 2, height: s * 2,
  });
}

// ---------------------------------------------------------------------------
// Activation bar
// ---------------------------------------------------------------------------

/** Generate DrawIO style for an activation bar. */
export function activationBarStyle(fillColor?: string, theme: Theme = createTheme()): string {
  const fill = normalizeColor(fillColor) || theme.participantFill;
  const stroke = darkenColor(fill);
  return [
    'html=1',
    'points=[]',
    'perimeter=orthogonalPerimeter',
    'outlineConnect=0',
    'targetShapes=umlLifeline',
    'portConstraint=eastwest',
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    `strokeWidth=${theme.strokeWidth}`,
  ].join(';') + ';';
}

/**
 * Render an activation bar to DrawIO mxCell XML strings.
 * Returns an array: [activation cell, optional destroy marker cell].
 *
 * When parentGeom is provided, coordinates are relative to the parent lifeline.
 */
export function renderActivationBar(
  act: {
    id: string;
    participant: string;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    destroyed?: boolean;
  },
  parentGeom?: { x: number; y: number },
  theme?: Theme,
): string[] {
  const cells: string[] = [];
  const style = activationBarStyle(act.color, theme);

  if (parentGeom) {
    const relX = act.x - parentGeom.x;
    const relY = act.y - parentGeom.y;
    cells.push(mxVertex({
      id: act.id, value: '', style, parent: act.participant,
      x: relX, y: relY, width: act.width, height: act.height,
    }));
  } else {
    cells.push(mxVertex({
      id: act.id, value: '', style,
      parent: '1',
      x: act.x, y: act.y, width: act.width, height: act.height,
    }));
  }

  // Destroy marker at the bottom of the activation bar
  if (act.destroyed) {
    const cx = act.x + act.width / 2;
    const cy = act.y + act.height;
    cells.push(renderDestroyMarker(
      act.id + '_destroy',
      cx,
      cy,
      parentGeom ? act.participant : undefined,
      parentGeom,
      theme,
    ));
  }

  return cells;
}
