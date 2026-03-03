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
  readonly labelFontSize: number;
  readonly titleFontSize: number;
  readonly spotFontSize: number;       // spot letter font size (14@12)
  readonly layoutFontSize: number;

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
  readonly arcSize: number;
  readonly largeArcSize: number;
  readonly cornerClip: number;

  // ── Sizes — fixed dimensions, min widths/heights ──────────────────────────
  readonly stateForkHeight: number;     //   4 — fork/join bar thickness
  readonly seqDestroyCrossSize: number; //   9 — destroy marker half-size
  readonly seqActBarWidth: number;      //  10 — activation bar width
  readonly classSepHeight: number;      //  10 — separator line height
  readonly portSize: number;            //  12 — port square size
  readonly iconMinLabelH: number;       //  18 — icon node minimum label height
  readonly mxIconMinLabelH: number;     //  20 — mxgraph icon minimum label height
  readonly titledSepHeight: number;     //  20 — titled separator height
  readonly fragCondMinH: number;        //  20 — fragment condition min height
  readonly fragSectionH: number;        //  20 — fragment section height
  readonly classRowHeight: number;      //  22 — row height for class members
  readonly portLabelH: number;          //  22 — port label height
  readonly spotSize: number;            //  22 — spot circle diameter
  readonly iconSize: number;            //  24 — small nodes (start/end, junctions)
  readonly capHeight: number;           //   9 — cap/ellipse height for non-titlebar shapes
  readonly titleBarHeight: number;      //  26 — title bar height for fixed-title shapes
  readonly containerMinH: number;       //  30 — bracket minimum height
  readonly noteMinW: number;            //  30 — note minimum width
  readonly personHeadH: number;         //  38 — person head circle height
  readonly legendMinW: number;          //  40 — legend minimum width
  readonly fragMinH: number;            //  40 — fragment minimum height
  readonly seqLifelineMinH: number;     //  40 — min lifeline height
  readonly archimateTabW: number;       //  42 — archimate folder tab width
  readonly seqSelfRefLoop: number;      //  45 — self-ref horizontal extent
  readonly defaultIconSize: number;     //  48 — fallback mxgraph icon size
  readonly tabMinWidth: number;         //  50 — min tab width for folder/frame
  readonly containerMinW: number;       //  60 — bracket minimum width
  readonly mxgraphIconSize: number;     //  60 — mxgraph icon target size
  readonly titleMinWidth: number;       //  72 — min width for titled containers
  readonly classMinWidth: number;       //  80 — minimum class node width
  readonly stateForkWidth: number;      //  80 — fork/join bar width
  readonly seqMinShortArrow: number;    //  80 — min short arrow length
  readonly maxRowWidth: number;         // 720 — max width for row-packing layout

  // ── Spacing — pad, gap, spacing, margin, offset (sorted small → large @base12) ──
  readonly portLabelPad: number;        //   3 — port square-to-label gap
  readonly spotMargin: number;          //   4 — spot circle right margin
  readonly edgeLabelGap: number;        //   4 — min gap between edge label and edge line
  readonly seqArrowPad: number;         //   4 — minimal padding around arrow line
  readonly iconGap: number;             //   4 — gap between icon and label below
  readonly classRowSpacingX: number;    //   4 — horizontal spacing in class rows
  readonly fragLabelSpacingX: number;   //   4 — fragment label horizontal spacing
  readonly fragLabelGap: number;        //   4 — gap after fragment tab label
  readonly mapColGap: number;           //   4 — gap between map columns
  readonly edgeEdgePx: number;          //   4 — min gap between parallel edges
  readonly classBodyPadY: number;       //   5 — vertical padding in class body
  readonly seqSmallPad: number;         //   5 — small padding (note gap, activation nest)
  readonly shadowOffset: number;        //   5 — collections shadow offset
  readonly cloudPadV: number;           //   6 — cloud shape vertical padding
  readonly octagonExtraV: number;       //   6 — octagon vertical extra height
  readonly groupSpacing: number;        //   8 — gap between sibling groups
  readonly fragSectionSpacingX: number; //   8 — fragment section horizontal spacing
  readonly containerSpacingX: number;   //  10 — bracket/rich-renderer horizontal spacing
  readonly seqMediumPad: number;        //  10 — medium padding (note overlap, fragment bottom)
  readonly cloudPadH: number;           //  10 — cloud shape horizontal padding
  readonly emptyBodyPad: number;        //  10 — empty body area height
  readonly edgeSnapPx: number;          //  10 — edge endpoint snap tolerance
  readonly titlePadY: number;           //  12 — vertical padding around title text
  readonly octagonExtraH: number;       //  14 — octagon horizontal extra width
  readonly actionPadH: number;          //  15 — action arrow shape horizontal padding
  readonly circleTextGap: number;       //  16 — circle-to-label gap
  readonly mxIconPadX: number;          //  16 — mxgraph icon label horizontal padding
  readonly titlePadX: number;           //  18 — horizontal padding around title text
  readonly iconPadX: number;            //  20 — icon node label horizontal padding
  readonly titleBottomGap: number;      //  20 — gap below title element
  readonly nodesepPx: number;           //  20 — min horizontal gap between nodes
  readonly groupPadding: number;        //  24 — inner padding for group containers
  readonly ranksepPx: number;           //  30 — min vertical gap between ranks
  readonly classPadX: number;           //  40 — horizontal padding for class title
  readonly circlePadX: number;          //  40 — circle node horizontal padding
  readonly seqExtBoundaryGap: number;   //  60 — external boundary gap
}

/** Create a fully computed Theme from minimal config. */
export function createTheme(config?: ThemeConfig): Theme {
  const fontSize = config?.fontSize ?? DEFAULT_FONT_SIZE;
  const fontFamily = config?.fontFamily ?? DEFAULT_FONT_FAMILY;
  const strokeWidth = (fontSize / 12).toFixed(1);

  return {
    // ── Typography ──
    fontSize,
    fontFamily,
    smallFontSize: Math.round(fontSize / 1.15),
    labelFontSize: Math.round(fontSize * 1.15),
    titleFontSize: Math.round(fontSize * 1.2),
    spotFontSize: Math.round(fontSize * 14 / 12),
    layoutFontSize: fontSize,

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
    arcSize: Math.round(fontSize / 3),
    largeArcSize: Math.round(fontSize),
    cornerClip: Math.round(fontSize * 6 / 12),

    // ── Sizes (sorted small → large @base12) ──
    stateForkHeight: Math.round(fontSize / 3),             //   4
    seqDestroyCrossSize: Math.round(fontSize * 9 / 12),    //   9
    seqActBarWidth: Math.round(fontSize * 10 / 12),        //  10
    classSepHeight: Math.round(fontSize * 10 / 12),        //  10
    portSize: fontSize,                                     //  12
    iconMinLabelH: Math.round(fontSize * 18 / 12),         //  18
    mxIconMinLabelH: Math.round(fontSize * 20 / 12),       //  20
    titledSepHeight: Math.round(fontSize * 20 / 12),       //  20
    fragCondMinH: Math.round(fontSize * 20 / 12),          //  20
    fragSectionH: Math.round(fontSize * 20 / 12),          //  20
    classRowHeight: Math.round(fontSize * 22 / 12),        //  22
    portLabelH: Math.round(fontSize * 22 / 12),            //  22
    spotSize: Math.round(fontSize * 22 / 12),              //  22
    iconSize: Math.round(fontSize * 2),                     //  24
    capHeight: Math.round(fontSize * 9 / 12),              //   9
    titleBarHeight: Math.round(fontSize * 26 / 12),        //  26
    containerMinH: Math.round(fontSize * 30 / 12),         //  30
    noteMinW: Math.round(fontSize * 30 / 12),              //  30
    personHeadH: Math.round(fontSize * 38 / 12),           //  38
    legendMinW: Math.round(fontSize * 40 / 12),            //  40
    fragMinH: Math.round(fontSize * 40 / 12),              //  40
    seqLifelineMinH: Math.round(fontSize * 40 / 12),       //  40
    archimateTabW: Math.round(fontSize * 42 / 12),         //  42
    seqSelfRefLoop: Math.round(fontSize * 45 / 12),        //  45
    defaultIconSize: Math.round(fontSize * 48 / 12),       //  48
    tabMinWidth: Math.round(fontSize * 50 / 12),           //  50
    containerMinW: Math.round(fontSize * 60 / 12),         //  60
    mxgraphIconSize: Math.round(fontSize * 5),              //  60
    titleMinWidth: Math.round(fontSize * 6),                //  72
    classMinWidth: Math.round(fontSize * 80 / 12),         //  80
    stateForkWidth: Math.round(fontSize * 8),               //  80
    seqMinShortArrow: Math.round(fontSize * 80 / 12),      //  80
    maxRowWidth: Math.round(fontSize * 60),                 // 720

    // ── Spacing (sorted small → large @base12) ──
    portLabelPad: Math.round(fontSize * 3 / 12),            //   3
    spotMargin: Math.round(fontSize * 4 / 12),              //   4
    edgeLabelGap: Math.round(fontSize / 3),                 //   4
    seqArrowPad: Math.round(fontSize / 3),                  //   4
    iconGap: Math.round(fontSize * 4 / 12),                 //   4
    classRowSpacingX: Math.round(fontSize * 4 / 12),        //   4
    fragLabelSpacingX: Math.round(fontSize * 4 / 12),       //   4
    fragLabelGap: Math.round(fontSize * 4 / 12),            //   4
    mapColGap: Math.round(fontSize * 4 / 12),               //   4
    edgeEdgePx: Math.round(fontSize * 4 / 12),              //   4
    classBodyPadY: Math.round(fontSize * 5 / 12),           //   5
    seqSmallPad: Math.round(fontSize * 5 / 12),             //   5
    shadowOffset: Math.round(fontSize * 5 / 12),            //   5
    containerSpacingX: Math.round(fontSize * 5 / 12),       //   5
    cloudPadV: Math.round(fontSize * 6 / 12),               //   6
    octagonExtraV: Math.round(fontSize * 6 / 12),           //   6
    groupSpacing: Math.round(fontSize * 2 / 3),             //   8
    fragSectionSpacingX: Math.round(fontSize * 8 / 12),     //   8
    seqMediumPad: Math.round(fontSize * 10 / 12),           //  10
    cloudPadH: Math.round(fontSize * 10 / 12),              //  10
    emptyBodyPad: Math.round(fontSize * 10 / 12),           //  10
    edgeSnapPx: Math.round(fontSize * 10 / 12),             //  10
    titlePadY: fontSize,                                     //  12
    octagonExtraH: Math.round(fontSize * 14 / 12),          //  14
    actionPadH: Math.round(fontSize * 15 / 12),             //  15
    circleTextGap: Math.round(fontSize * 16 / 12),          //  16
    mxIconPadX: Math.round(fontSize * 16 / 12),             //  16
    titlePadX: Math.round(fontSize * 1.5),                   //  18
    iconPadX: Math.round(fontSize * 20 / 12),               //  20
    titleBottomGap: Math.round(fontSize * 20 / 12),         //  20
    nodesepPx: Math.round(fontSize * 20 / 12),              //  20
    groupPadding: Math.round(fontSize * 2),                  //  24
    ranksepPx: Math.round(fontSize * 30 / 12),              //  30
    classPadX: Math.round(fontSize * 40 / 12),              //  40
    circlePadX: Math.round(fontSize * 40 / 12),             //  40
    seqExtBoundaryGap: Math.round(fontSize * 40 / 12),      //  40
  };
}

