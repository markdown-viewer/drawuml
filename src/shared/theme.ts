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
  /** Theme mode preset. Default: 'light'. */
  mode?: 'light' | 'dark';
  /** PlantUML theme name (e.g. 'plain'), used to apply theme-specific overrides. */
  themeName?: string;
  /** Base font size (default: 12). All sizing derives from this. */
  fontSize?: number;
  /** Font family (default: DEFAULT_FONT_FAMILY from text-measure). */
  fontFamily?: string;
  /** Note font family override. */
  noteFontFamily?: string;
  /** Note font size override. */
  noteFontSize?: number;
  /** Default text color for generic labels and titles. */
  fontColor?: string;
  /** Note text color override. */
  noteFontColor?: string;
  /** Global arrow stroke color. */
  arrowColor?: string;
  /** Global arrow label color. */
  arrowFontColor?: string;
  /** Global arrow stroke width. */
  arrowStrokeWidth?: number;
  /** Note fill color override. */
  noteFill?: string;
  /** Note border color override. */
  noteBorderColor?: string;
  /** Note connector color override. */
  noteLinkColor?: string;
  /** Sequence participant fill. */
  participantFill?: string;
  /** Sequence participant border color. */
  participantBorderColor?: string;
  /** Sequence participant text color. */
  participantFontColor?: string;
  /** Sequence lifeline stroke color. */
  lifelineStrokeColor?: string;
  /** Sequence lifeline stroke width. */
  lifelineStrokeWidth?: number;
  /** Sequence frame stroke color. */
  frameStrokeColor?: string;
  /** Extra participant spacing for sequence layout. */
  participantPadding?: number;
  /** Extra box spacing for sequence layout. */
  boxPadding?: number;
}

/** Full computed theme — all values ready for use. */
export interface Theme {
  readonly mode: 'light' | 'dark';
  // ── Typography ────────────────────────────────────────────────────────────
  readonly fontSize: number;
  readonly fontFamily: string;
  readonly smallFontSize: number;
  readonly titleFontSize: number;
  readonly spotFontSize: number;       // spot letter font size (14@12)

  // ── Colors & fills ────────────────────────────────────────────────────────
  readonly colorDark: string;
  readonly fontColor: string;
  readonly defaultFill: string;
  readonly groupFill: string;
  readonly participantFill: string;
  readonly participantBorderColor: string;
  readonly participantFontColor: string;
  readonly lifelineStrokeColor: string;
  readonly dividerFill: string;
  readonly legendFill: string;
  readonly noteLinkColor: string;
  readonly noteFill: string;
  readonly noteBorderColor: string;
  readonly noteFontColor: string;
  readonly noteFontFamily: string;
  readonly noteFontSize: number;
  readonly destroyStroke: string;
  readonly arrowColor: string;
  readonly arrowFontColor: string;
  readonly frameStrokeColor: string;

  /** PlantUML theme name applied (e.g. 'plain'), or undefined for default. */
  readonly themeName?: string;
  /** IE_MANDATORY visibility dot fill style — true: filled black dot (default),
   *  false: hollow white dot with black border (plain theme). */
  readonly ieMandatoryFilled: boolean;

  // ── Gantt-specific colors ────────────────────────────────────────────────
  readonly ganttTaskFill: string;         // default task bar fill (no completion, or 100% completed)
  readonly ganttUnstartedFill: string;   // unstarted blend source (0% end, only used when explicit style)
  readonly ganttOverloadColor: string;   // resource overload text color

  // ── Stroke & corner ───────────────────────────────────────────────────────
  readonly strokeWidth: number;
  readonly arrowStrokeWidth: number;
  readonly lifelineStrokeWidth: number;
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
  readonly sizeXXL: number;   //  @12→100 — gantt yearly cell width
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
  readonly participantPadding: number;
  readonly boxPadding: number;
}

/** Round a number to at most 4 decimal places, stripping trailing zeros. */
function r4(v: number): number { return +v.toFixed(4); }

function getSkinparamValue(skinparams: Record<string, string> | undefined, key: string): string | undefined {
  if (!skinparams) return undefined;
  if (Object.prototype.hasOwnProperty.call(skinparams, key)) return skinparams[key];
  const foundKey = Object.keys(skinparams).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return foundKey ? skinparams[foundKey] : undefined;
}

function stripOptionalQuotes(value?: string): string | undefined {
  if (!value) return value;
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Create a fully computed Theme from minimal config. */
export function createTheme(config?: ThemeConfig): Theme {
  const mode = config?.mode === 'dark' ? 'dark' : 'light';
  const themeName = config?.themeName;
  // PlantUML `plain` theme: white node background, hollow IE_MANDATORY dot,
  // black stroke. Matches puml-theme-plain.puml (BackgroundColor $BGCOLOR=white).
  const isPlainTheme = themeName === 'plain';
  const fontSize = config?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = stripOptionalQuotes(config?.fontFamily) ?? DEFAULT_FONT_FAMILY;
  const strokeWidth = r4(fontSize / 12);
  const fontColor = config?.fontColor ?? (mode === 'dark' ? '#FFFFFF' : '#181818');
  const noteFill = config?.noteFill ?? (mode === 'dark' ? '#4F4F2A' : '#FEFFDD');
  const noteBorderColor = config?.noteBorderColor ?? (mode === 'dark' ? '#C8C88A' : '#AEAE8F');
  const noteLinkColor = config?.noteLinkColor ?? noteBorderColor;
  const noteFontColor = config?.noteFontColor ?? (mode === 'dark' ? '#FFFFFF' : '#000000');
  const noteFontFamily = stripOptionalQuotes(config?.noteFontFamily) ?? fontFamily;
  const noteFontSize = config?.noteFontSize ?? fontSize;
  const participantFill = config?.participantFill ?? (mode === 'dark' ? '#313139' : '#E2E2F0');
  const participantBorderColor = config?.participantBorderColor ?? (mode === 'dark' ? '#E7E7E7' : '#181818');
  const participantFontColor = config?.participantFontColor ?? fontColor;
  const lifelineStrokeColor = config?.lifelineStrokeColor ?? participantBorderColor;
  const arrowColor = config?.arrowColor ?? (mode === 'dark' ? '#E7E7E7' : '#181818');
  const arrowFontColor = config?.arrowFontColor ?? fontColor;
  const frameStrokeColor = config?.frameStrokeColor ?? (mode === 'dark' ? '#E7E7E7' : '#181818');
  const arrowStrokeWidth = r4(config?.arrowStrokeWidth ?? strokeWidth);
  const lifelineStrokeWidth = r4(config?.lifelineStrokeWidth ?? strokeWidth);

  // ── Spec variables — computed once, referenced by semantic aliases ──
  const sizeXXS = r4(fontSize * 5 / 12);
  const sizeXS  = r4(fontSize * 10 / 12);
  const sizeS   = r4(fontSize * 20 / 12);
  const sizeM   = r4(fontSize * 30 / 12);
  const sizeL   = r4(fontSize * 40 / 12);
  const sizeXL  = r4(fontSize * 60 / 12);
  const sizeXXL = r4(fontSize * 100 / 12);
  const sizeMax = r4(fontSize * 720 / 12);

  const padXXS = r4(fontSize * 2 / 12);
  const padXS  = r4(fontSize * 5 / 12);
  const padS   = r4(fontSize * 10 / 12);
  const padM   = r4(fontSize * 15 / 12);
  const padL   = r4(fontSize * 20 / 12);
  const padXL  = r4(fontSize * 30 / 12);
  const padXXL = r4(fontSize * 40 / 12);

  return {
    mode,
    themeName,
    // ── Typography ──
    fontSize,
    fontFamily,
    smallFontSize: r4(fontSize / 1.1),
    spotFontSize: r4(fontSize * 1.1),
    titleFontSize: r4(fontSize * 1.2),

    // ── Colors & fills ──
  colorDark: mode === 'dark' ? '#E7E7E7' : '#181818',
    fontColor,
  defaultFill: isPlainTheme ? '#FFFFFF' : (mode === 'dark' ? '#313139' : '#F1F1F1'),
  groupFill: mode === 'dark' ? '#1F1F23' : '#FFFFFF',
    participantFill,
    participantBorderColor,
    participantFontColor,
    lifelineStrokeColor,
  dividerFill: mode === 'dark' ? '#222228' : '#EEEEEE',
  legendFill: mode === 'dark' ? '#2A2A2F' : '#DDDDDD',
    noteLinkColor,
    noteFill,
    noteBorderColor,
    noteFontColor,
    noteFontFamily,
    noteFontSize,
  destroyStroke: mode === 'dark' ? '#FF6B9A' : '#A80036',
    arrowColor,
    arrowFontColor,
    frameStrokeColor,

    // ── Visibility icon fills ──
    // plain theme renders IE_MANDATORY (*) as hollow (white fill + black border)
    // because the root style cascade sets BackgroundColor=white, LineColor=black.
    ieMandatoryFilled: !isPlainTheme,

    // ── Gantt-specific colors (only where base theme colors don't match) ──
    ganttTaskFill: mode === 'dark' ? '#555555' : '#E2E2F0',
    ganttUnstartedFill: mode === 'dark' ? '#E2E2F0' : '#E2E2F0',
    ganttOverloadColor: mode === 'dark' ? '#FF6666' : '#FF0000',

    // ── Stroke & corner ──
    strokeWidth: strokeWidth,
    arrowStrokeWidth,
    lifelineStrokeWidth,
    boldStrokeWidth: r4(strokeWidth * 2),
    largeArcSize: fontSize,
    cornerClip: r4(fontSize * 8 / 12),

    // ── Sizes — 7 standardized tiers ──
    sizeXXS, sizeXS, sizeS, sizeM, sizeL, sizeXL, sizeXXL, sizeMax,

    // ── Spacing — 7 unified tiers ──
    padXXS, padXS, padS, padM, padL, padXL, padXXL,

    // ── Semantic aliases ──
    // Heights
    rowH: sizeS,       titleBarH: sizeM,     tabH: sizeS,
    // Element sizes
    arcSize: sizeXS,   iconSize: sizeM,   spotSize: sizeS,   portSize: sizeXS,
    // Minimum widths
    tabMinW: sizeM,    nodeMinW: sizeL,      titleMinW: sizeXL,
    // Interior padding
    contentPad: padS,  titlePadY: padS,      titlePadX: padXL,  spacingTop: padXXS,
    // Layout gaps
    edgeGap: padXS,    nodeGap: padL,        groupPad: padXL,   unitGap: padXL,    layerGap: padXXL,
    participantPadding: config?.participantPadding ?? padS,
    boxPadding: config?.boxPadding ?? padS,
  };
}

function parseThemeNumber(raw?: string): number | undefined {
  if (!raw) return undefined;
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function createThemeFromSkinparams(
  skinparams?: Record<string, string>,
  baseConfig?: ThemeConfig,
): Theme {
  // !theme <name> directive is stored as skinparams.__theme by the parser.
  const themeName = getSkinparamValue(skinparams, '__theme') || baseConfig?.themeName;
  return createTheme({
    ...baseConfig,
    mode: baseConfig?.mode,
    themeName,
    fontFamily: stripOptionalQuotes(getSkinparamValue(skinparams, 'defaultFontName')) || baseConfig?.fontFamily,
    fontColor: getSkinparamValue(skinparams, 'defaultFontColor') || baseConfig?.fontColor,
    noteFill: getSkinparamValue(skinparams, 'NoteBackgroundColor') || baseConfig?.noteFill,
    noteBorderColor: getSkinparamValue(skinparams, 'NoteBorderColor') || baseConfig?.noteBorderColor,
    noteFontColor: getSkinparamValue(skinparams, 'NoteFontColor') || baseConfig?.noteFontColor,
    noteFontFamily: stripOptionalQuotes(getSkinparamValue(skinparams, 'NoteFontName')) || baseConfig?.noteFontFamily,
    noteFontSize: parseThemeNumber(getSkinparamValue(skinparams, 'NoteFontSize')) ?? baseConfig?.noteFontSize,
    arrowColor: getSkinparamValue(skinparams, 'ArrowColor') || baseConfig?.arrowColor,
    arrowFontColor: getSkinparamValue(skinparams, 'ArrowFontColor') || baseConfig?.arrowFontColor,
    arrowStrokeWidth: parseThemeNumber(getSkinparamValue(skinparams, 'ArrowThickness')) ?? baseConfig?.arrowStrokeWidth,
    participantFill: getSkinparamValue(skinparams, 'ParticipantBackgroundColor') || baseConfig?.participantFill,
    participantBorderColor: getSkinparamValue(skinparams, 'ParticipantBorderColor') || baseConfig?.participantBorderColor,
    participantFontColor: getSkinparamValue(skinparams, 'ParticipantFontColor') || baseConfig?.participantFontColor,
    lifelineStrokeColor: getSkinparamValue(skinparams, 'SequenceLifeLineBorderColor') || baseConfig?.lifelineStrokeColor,
    lifelineStrokeWidth: parseThemeNumber(getSkinparamValue(skinparams, 'SequenceLifeLineBorderThickness')) ?? baseConfig?.lifelineStrokeWidth,
    participantPadding: parseThemeNumber(getSkinparamValue(skinparams, 'ParticipantPadding')) ?? baseConfig?.participantPadding,
    boxPadding: parseThemeNumber(getSkinparamValue(skinparams, 'BoxPadding')) ?? baseConfig?.boxPadding,
  });
}

/**
 * Return `fontFamily=<value>;` style fragment when theme uses a custom font,
 * empty string when using the default font.
 */
export function fontFamilyStyle(theme: Theme): string {
  return theme.fontFamily !== DEFAULT_FONT_FAMILY ? `fontFamily=${theme.fontFamily};` : '';
}
