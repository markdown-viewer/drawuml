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
  // ── Typography ────────────────────────────────────────────────────────────
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly smallFontSize: number;
  readonly titleFontSize: number;
  readonly spotFontSize: number;       // spot letter font size (14@12)

  // ── Colors & fills ────────────────────────────────────────────────────────
  readonly colorDark: string;
  readonly defaultFill: string;
  readonly classFill: string;
  readonly dividerFill: string;
  readonly legendFill: string;
  readonly noteLinkColor: string;
  readonly destroyStroke: string;

  // ── Stroke & corner ───────────────────────────────────────────────────────
  readonly strokeWidth: number;
  readonly boldStrokeWidth: number;    // strokeWidth × 2, used for bold lines
  readonly arcSize: number;
  readonly largeArcSize: number;
  readonly cornerClip: number;

  // ── Sizes — 7 standardized tiers (×N/12 of fontSize) ────────────────────
  readonly sizeXXS: number;   //  @12→ 5  — fork bar thickness, etc.
  readonly sizeXS: number;    //  @12→10  — cap height, port, separator, activation bar, destroy cross
  readonly sizeS: number;     //  @12→20  — title bar, spot, row heights, icon label, archimate icon
  readonly sizeM: number;     //  @12→30  — icon size, tab width
  readonly sizeL: number;     //  @12→40  — dot min node width, fragment/lifeline min, self-ref loop
  readonly sizeXL: number;    //  @12→60  — class/title min width, fork width, icon target, short arrow
  readonly sizeMax: number;   //  @12→720 — max row width for row-packing layout

  // ── Spacing — 5 unified tiers (sorted small → large @base12) ──────────────
  readonly padXS: number;               //   5 — extra small spacing (@base12: fontSize×5/12)
  readonly padS: number;                //  10 — small spacing  (@base12: fontSize×10/12)
  readonly padM: number;                //  15 — medium spacing (@base12: fontSize×15/12)
  readonly padL: number;                //  20 — large spacing  (@base12: fontSize×20/12)
  readonly padXL: number;               //  30 — extra large    (@base12: fontSize×30/12)
  readonly padXXL: number;              //  40 — extra extra large (@base12: fontSize×40/12)
}

/** Round a number to at most 4 decimal places, stripping trailing zeros. */
function r4(v: number): number { return +v.toFixed(4); }

/** Create a fully computed Theme from minimal config. */
export function createTheme(config?: ThemeConfig): Theme {
  const fontSize = config?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = config?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const strokeWidth = r4(fontSize / 12);

  return {
    // ── Typography ──
    fontSize,
    fontFamily,
    smallFontSize: r4(fontSize / 1.1),
    spotFontSize: r4(fontSize * 1.1),
    titleFontSize: r4(fontSize * 1.2),

    // ── Colors & fills ──
    colorDark: '#181818',
    defaultFill: '#F1F1F1',
    classFill: '#FFFFFF',
    dividerFill: '#EEEEEE',
    legendFill: '#DDDDDD',
    noteLinkColor: '#AEAE8F',
    destroyStroke: '#A80036',

    // ── Stroke & corner ──
    strokeWidth: strokeWidth,
    boldStrokeWidth: r4(strokeWidth * 2),
    arcSize: r4(fontSize / 3),
    largeArcSize: fontSize,
    cornerClip: r4(fontSize * 6 / 12),

    // ── Sizes — 7 standardized tiers ──
    sizeXXS: r4(fontSize * 5 / 12),     //   5
    sizeXS: r4(fontSize * 10 / 12),     //  10
    sizeS: r4(fontSize * 20 / 12),      //  20
    sizeM: r4(fontSize * 30 / 12),      //  30
    sizeL: r4(fontSize * 40 / 12),      //  40
    sizeXL: r4(fontSize * 60 / 12),     //  60
    sizeMax: r4(fontSize * 720 / 12),   // 720

    // ── Spacing — 5 unified tiers ──
    padXS: r4(fontSize * 5 / 12),       //   5
    padS: r4(fontSize * 10 / 12),       //  10
    padM: r4(fontSize * 15 / 12),       //  15
    padL: r4(fontSize * 20 / 12),       //  20
    padXL: r4(fontSize * 30 / 12),      //  30
    padXXL: r4(fontSize * 40 / 12),     //  40
  };
}

