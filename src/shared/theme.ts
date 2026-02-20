/**
 * Default PlantUML color palette and typography constants (2026 theme).
 *
 * Centralized constants to avoid hardcoding hex values and font sizes
 * across primitives. These match PlantUML's current default rendering.
 */

import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '@markdown-viewer/text-measure';

// Re-export font family from text-measure so consumers only depend on theme.ts
export { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE };

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/** Small font size for auxiliary labels (choice label, fragment tab, duration constraint). */
export const SMALL_FONT_SIZE = 11;

/** Font size for container labels (box label). */
export const LABEL_FONT_SIZE = 13;

/** Font size for titles and circle nodes. */
export const TITLE_FONT_SIZE = 14;

// ---------------------------------------------------------------------------
// Core palette
// ---------------------------------------------------------------------------

/** Near-black used for strokes, borders, text, pseudo-states, and group outlines.
 *  PlantUML uses #000000/#181818/#222222 interchangeably — merged here. */
export const COLOR_DARK = '#181818';

/** Default fill color for generic nodes (activity, state, circle, diamond, bracket, etc.) */
export const DEFAULT_FILL = '#F1F1F1';

/** Default fill for class swimlane nodes and frames */
export const CLASS_FILL = '#FFFFFF';

/** Default stroke width for generic nodes */
export const DEFAULT_STROKE_WIDTH = 0.5;

// ---------------------------------------------------------------------------
// Misc fills
// ---------------------------------------------------------------------------

/** Divider box fill color */
export const DIVIDER_FILL = '#EEEEEE';

// ---------------------------------------------------------------------------
// Shape padding (leaf node sizing)
// ---------------------------------------------------------------------------

/** Minimum width for title-only leaf nodes (matches participant rectangle). */
export const TITLE_MIN_WIDTH = 80;

/** Horizontal padding for title-only leaf nodes (matches participant rectangle). */
export const TITLE_PAD_X = 20;

/** Vertical padding for title-only leaf nodes (matches participant rectangle). */
export const TITLE_PAD_Y = 12;

/** Horizontal padding for leaf nodes with body content (matches note). */
export const CONTENT_PAD_X = 23;

/** Vertical padding for leaf nodes with body content (matches note). */
export const CONTENT_PAD_Y = 10;

/** Legend box fill color */
export const LEGEND_FILL = '#DDDDDD';

// ---------------------------------------------------------------------------
// Accent colors
// ---------------------------------------------------------------------------

/** Note link/anchor dashed line color */
export const NOTE_LINK_COLOR = '#AEAE8F';

/** Sequence destroy marker stroke color */
export const DESTROY_STROKE = '#A80036';

// ---------------------------------------------------------------------------
// DOT layout constants
// ---------------------------------------------------------------------------

/** Minimum horizontal gap between nodes in the same rank (px). */
export const DOT_NODESEP_PX = 40;

/** Minimum vertical gap between ranks (px). */
export const DOT_RANKSEP_PX = 50;

/** Target maximum row width for orphan node packing (px). */
export const DOT_MAX_ROW_WIDTH = 700;

/** Font size for DOT edge/node labels.
 *  Must be >= the actual rendered font (LABEL 13, TITLE 14) so Graphviz
 *  reserves enough space for titles and labels. */
export const DOT_FONT_SIZE = 14;
