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
  readonly groupFill: string;
  readonly participantFill: string;
  readonly dividerFill: string;
  readonly legendFill: string;
  readonly noteLinkColor: string;
  readonly destroyStroke: string;

  // ── Stroke & corner ───────────────────────────────────────────────────────
  readonly strokeWidth: number;
  readonly boldStrokeWidth: number;    // strokeWidth × 2, used for bold lines
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
  readonly padXXS: number;              //   2 — micro spacing    (@base12: fontSize×2/12)
  readonly padXS: number;               //   5 — extra small spacing (@base12: fontSize×5/12)
  readonly padS: number;                //  10 — small spacing  (@base12: fontSize×10/12)
  readonly padM: number;                //  15 — medium spacing (@base12: fontSize×15/12)
  readonly padL: number;                //  20 — large spacing  (@base12: fontSize×20/12)
  readonly padXL: number;               //  30 — extra large    (@base12: fontSize×30/12)
  readonly padXXL: number;              //  40 — extra extra large (@base12: fontSize×40/12)

  // ── Semantic aliases ─────────────────────────────────────────────────────

  // Heights  (all = sizeS @12→20)
  readonly rowH: number;        // map / class body row height
  readonly titleBarH: number;   // swimlane startSize, card title, state title
  readonly tabH: number;        // folder / frame / fragment tab height

  // Element sizes
  readonly arcSize: number;     // rounded corner arc size                  (= sizeXS, 10)
  readonly iconSize: number;    // icon renderer scale basis                (= sizeM,  30)
  readonly spotSize: number;    // spot circle diameter                     (= sizeS,  20)
  readonly portSize: number;    // port square, cylinder cap                (= sizeXS, 10)

  // Minimum widths
  readonly tabMinW: number;     // tab strip min-width                      (= sizeM,  30)
  readonly nodeMinW: number;    // DOT node min-width, lifeline min-height  (= sizeL,  40)
  readonly titleMinW: number;   // class/sequence title min-width           (= sizeXL, 60)

  // Interior padding  (inside a box / cell)
  readonly contentPad: number;  // general content area padding   (= padS,   10)
  readonly titlePadY: number;   // title bar vertical pad         (= padS,   10)
  readonly titlePadX: number;   // title bar horizontal pad       (= padXL,  30)
  readonly spacingTop: number;  // DrawIO spacingTop micro-gap    (= padXXS,  2)

  // Layout gaps  (between elements)
  readonly edgeGap: number;     // edge / label gap               (= padXS,   5)
  readonly nodeGap: number;     // node-to-node gap               (= padL,   20)
  readonly groupPad: number;    // cluster interior padding       (= padXL,  30)
  readonly unitGap: number;     // sequence unit gap              (= padXL,  30)
  readonly layerGap: number;    // layer-to-layer ranksep         (= padXXL, 40)
}

/** Round a number to at most 4 decimal places, stripping trailing zeros. */
function r4(v: number): number { return +v.toFixed(4); }

/** Create a fully computed Theme from minimal config. */
export function createTheme(config?: ThemeConfig): Theme {
  const fontSize = config?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = config?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const strokeWidth = r4(fontSize / 12);

  // ── Spec variables — computed once, referenced by semantic aliases ──
  const sizeXXS = r4(fontSize * 5 / 12);
  const sizeXS  = r4(fontSize * 10 / 12);
  const sizeS   = r4(fontSize * 20 / 12);
  const sizeM   = r4(fontSize * 30 / 12);
  const sizeL   = r4(fontSize * 40 / 12);
  const sizeXL  = r4(fontSize * 60 / 12);
  const sizeMax = r4(fontSize * 720 / 12);

  const padXXS = r4(fontSize * 2 / 12);
  const padXS  = r4(fontSize * 5 / 12);
  const padS   = r4(fontSize * 10 / 12);
  const padM   = r4(fontSize * 15 / 12);
  const padL   = r4(fontSize * 20 / 12);
  const padXL  = r4(fontSize * 30 / 12);
  const padXXL = r4(fontSize * 40 / 12);

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
    groupFill: '#FFFFFF',
    participantFill: '#E2E2F0',
    dividerFill: '#EEEEEE',
    legendFill: '#DDDDDD',
    noteLinkColor: '#AEAE8F',
    destroyStroke: '#A80036',

    // ── Stroke & corner ──
    strokeWidth: strokeWidth,
    boldStrokeWidth: r4(strokeWidth * 2),
    largeArcSize: fontSize,
    cornerClip: r4(fontSize * 8 / 12),

    // ── Sizes — 7 standardized tiers ──
    sizeXXS, sizeXS, sizeS, sizeM, sizeL, sizeXL, sizeMax,

    // ── Spacing — 7 unified tiers ──
    padXXS, padXS, padS, padM, padL, padXL, padXXL,

    // ── Semantic aliases ──
    // Heights
    rowH: sizeS,       titleBarH: sizeS,     tabH: sizeS,
    // Element sizes
    arcSize: sizeXS,   iconSize: sizeM,   spotSize: sizeS,   portSize: sizeXS,
    // Minimum widths
    tabMinW: sizeM,    nodeMinW: sizeL,      titleMinW: sizeXL,
    // Interior padding
    contentPad: padS,  titlePadY: padS,      titlePadX: padXL,  spacingTop: padXXS,
    // Layout gaps
    edgeGap: padXS,    nodeGap: padL,        groupPad: padXL,   unitGap: padXL,    layerGap: padXXL,
  };
}

/**
 * Return `fontFamily=<value>;` style fragment when theme uses a custom font,
 * empty string when using the default font.
 */
export function fontFamilyStyle(theme: Theme): string {
  return theme.fontFamily !== DEFAULT_FONT_FAMILY ? `fontFamily=${theme.fontFamily};` : '';
}
