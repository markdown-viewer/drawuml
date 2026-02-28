/**
 * Theme configuration for PlantUML → DrawIO rendering.
 *
 * Provides Theme interface and createTheme() factory.
 * All sizing derives from a base fontSize (default 12).
 */

import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '@markdown-viewer/text-measure';

// ---------------------------------------------------------------------------
// Theme interface & factory
// ---------------------------------------------------------------------------

/** Minimal input for theme creation. Defaults computed from fontSize. */
export interface ThemeConfig {
  /** Base font size (default: 12). All sizing derives from this. */
  fontSize?: number;
  /** Font family (default: DEFAULT_FONT_FAMILY from text-measure). */
  fontFamily?: string;
}

/** Full computed theme — all values ready for use. */
export interface Theme {
  // Typography
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly smallFontSize: number;
  readonly labelFontSize: number;
  readonly titleFontSize: number;

  // Core palette
  readonly colorDark: string;
  readonly defaultFill: string;
  readonly classFill: string;
  readonly defaultStrokeWidth: number;
  readonly rectArcSize: number;

  // Misc fills
  readonly dividerFill: string;
  readonly legendFill: string;

  // Shape padding
  readonly titleMinWidth: number;
  readonly titlePadX: number;
  readonly titlePadY: number;
  readonly contentPadX: number;
  readonly contentPadY: number;

  // Accent colors
  readonly noteLinkColor: string;
  readonly destroyStroke: string;

  // DOT layout
  readonly dotNodesepPx: number;
  readonly dotRanksepPx: number;
  readonly dotMaxRowWidth: number;
  readonly dotFontSize: number;
}

/** Create a fully computed Theme from minimal config. */
export function createTheme(config?: ThemeConfig): Theme {
  const fontSize = config?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = config?.fontFamily ?? DEFAULT_FONT_FAMILY;

  return {
    fontSize,
    fontFamily,
    smallFontSize: fontSize / 1.15,
    labelFontSize: fontSize * 1.15,
    titleFontSize: fontSize * 1.2,

    colorDark: '#181818',
    defaultFill: '#F1F1F1',
    classFill: '#FFFFFF',
    defaultStrokeWidth: fontSize / 24,
    rectArcSize: fontSize / 3,

    dividerFill: '#EEEEEE',
    legendFill: '#DDDDDD',

    titleMinWidth: fontSize * 6,
    titlePadX: fontSize * 1.5,
    titlePadY: fontSize,
    contentPadX: fontSize * 1.6,
    contentPadY: fontSize / 1.2,

    noteLinkColor: '#AEAE8F',
    destroyStroke: '#A80036',

    dotNodesepPx: fontSize * 3.33,
    dotRanksepPx: fontSize * 4.17,
    dotMaxRowWidth: fontSize * 58.33,
    dotFontSize: fontSize,
  };
}

