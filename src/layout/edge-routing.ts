/**
 * Edge routing — parse Graphviz B-spline pos strings into DrawIO waypoints.
 *
 * Graphviz edge pos format:
 *   "[e,ex,ey] [s,sx,sy] x0,y0 x1,y1 x2,y2 x3,y3 ..."
 *
 * - e,ex,ey = arrow-tip endpoint
 * - s,sx,sy = start-point override
 * - Remaining points form cubic Bézier segments:
 *     start, then groups of 3 (cp1, cp2, end)
 *
 * We convert each cubic Bézier to quadratic control points using
 * de Casteljau subdivision + degree reduction, producing control
 * points compatible with DrawIO's curved=1 midpoint-interpolation
 * renderer (Q commands with midpoint on-curve points).
 *
 * Mathematical guarantee: splitting a cubic at t=0.5 and computing
 * the optimal single-quadratic approximation for each half yields
 * two control points whose midpoint equals cubic(0.5) exactly,
 * preserving C0 continuity in the DrawIO quadratic B-spline.
 */

interface Point {
  x: number;
  y: number;
}

/**
 * Parse a Graphviz edge pos string and return waypoints in DrawIO coordinates.
 *
 * @param pos       Raw pos string from viz.js JSON edge
 * @param maxY      Max Y from node layout (for Y-flip)
 * @param xShift    X offset applied to nodes
 * @param margin    Top margin (default 40)
 */
export function parseEdgePos(
  pos: string,
  maxY: number,
  xShift: number,
  margin = 40,
): Point[] {
  let endPoint: Point | null = null;
  let startPoint: Point | null = null;
  const tokens: Point[] = [];

  // Split by whitespace, identify prefixed tokens
  for (const token of pos.split(/\s+/)) {
    if (token.startsWith('e,')) {
      const coords = token.slice(2).split(',').map(Number);
      endPoint = { x: coords[0], y: coords[1] };
    } else if (token.startsWith('s,')) {
      const coords = token.slice(2).split(',').map(Number);
      startPoint = { x: coords[0], y: coords[1] };
    } else {
      const coords = token.split(',').map(Number);
      if (coords.length === 2 && !isNaN(coords[0])) {
        tokens.push({ x: coords[0], y: coords[1] });
      }
    }
  }

  // Coordinate transform: flip Y, shift X (matching node transform)
  const transform = (p: Point): Point => ({
    x: p.x + xShift,
    y: maxY - p.y + margin,
  });

  // Build cubic Bézier segment list from tokens
  // Each segment: { p0, p1, p2, p3 } (start, ctrl1, ctrl2, end)
  let cubics: { p0: Point; p1: Point; p2: Point; p3: Point }[] = [];
  if (tokens.length >= 4) {
    for (let i = 1; i + 2 < tokens.length; i += 3) {
      cubics.push({
        p0: i === 1 ? tokens[0] : tokens[i - 1],
        p1: tokens[i],
        p2: tokens[i + 1],
        p3: tokens[i + 2],
      });
    }

  }

  // Convert clipped cubic segments to DrawIO waypoints
  const waypoints: Point[] = [];

  if (cubics.length > 0) {
    waypoints.push(transform(startPoint || cubics[0].p0));

    for (const seg of cubics) {
      const controls = cubicToDrawioControls(seg.p0, seg.p1, seg.p2, seg.p3);
      for (const c of controls) waypoints.push(transform(c));
    }

    waypoints.push(transform(endPoint || cubics[cubics.length - 1].p3));
  } else if (tokens.length > 0) {
    // Fallback: transform all raw points
    for (const t of tokens) waypoints.push(transform(t));
    if (endPoint) waypoints.push(transform(endPoint));
  }

  return simplifyCollinear(waypoints);
}

/**
 * Remove collinear intermediate points from a waypoint list.
 * If three consecutive points lie on the same line (within a small epsilon),
 * the middle point is redundant and can be removed.
 * This prevents straight-line edges from carrying unnecessary waypoints.
 */
function simplifyCollinear(points: Point[], epsilon = 1.5): Point[] {
  if (points.length <= 2) return points;
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1];
    const cur = points[i];
    const next = points[i + 1];
    // Cross product of vectors (prev→cur) and (prev→next)
    const cross = (cur.x - prev.x) * (next.y - prev.y)
                - (cur.y - prev.y) * (next.x - prev.x);
    // Normalize by |prev→next| so epsilon represents perpendicular pixel distance
    const dist = Math.sqrt((next.x - prev.x) ** 2 + (next.y - prev.y) ** 2);
    if (dist > 0 && Math.abs(cross) / dist > epsilon) {
      result.push(cur);
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

// ---------------------------------------------------------------------------
// Cubic Bézier → DrawIO quadratic control point conversion
// ---------------------------------------------------------------------------

/** Midpoint of two points. */
function midP(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Compute single quadratic Bézier control point that best approximates
 * a cubic Bézier (degree reduction formula).
 */
function cubicToQuadControl(p0: Point, p1: Point, p2: Point, p3: Point): Point {
  return {
    x: (3 * (p1.x + p2.x) - p0.x - p3.x) / 4,
    y: (3 * (p1.y + p2.y) - p0.y - p3.y) / 4,
  };
}

/**
 * Convert a cubic Bézier to quadratic control points for DrawIO's
 * curved=1 midpoint-interpolation format.
 *
 * Splits the cubic at t=0.5 (de Casteljau) and computes the optimal
 * single-quadratic approximation for each half.  The midpoint of the
 * two returned control points equals cubic(0.5) exactly, preserving
 * C0 continuity in the DrawIO quadratic B-spline.
 */
function cubicToDrawioControls(
  p0: Point, p1: Point, p2: Point, p3: Point,
): Point[] {
  // de Casteljau split at t = 0.5
  const m01 = midP(p0, p1);
  const m12 = midP(p1, p2);
  const m23 = midP(p2, p3);
  const m012 = midP(m01, m12);
  const m123 = midP(m12, m23);
  const m0123 = midP(m012, m123); // = cubic(0.5)

  // Quadratic control for each half-cubic (degree reduction)
  const qcL = cubicToQuadControl(p0, m01, m012, m0123);
  const qcR = cubicToQuadControl(m0123, m123, m23, p3);

  return [qcL, qcR];
}

