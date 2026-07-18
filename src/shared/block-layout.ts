/**
 * BlockLayout — composite layout container for structured content blocks.
 *
 * Replaces the deprecated Content class. Handles:
 *   1. **Factory** — classBody / richBody / bracketBody / rich
 *   2. **Measure** — layout.measure() — structural content-aware sizing
 *   3. **Render**  — layout.renderChildren() — child mxCells under a container
 *
 * Text processing (Creole → HTML) is handled by TextBlock.
 * BlockLayout only owns the composite block layout (rows, separators, rich blocks).
 */

import { mxVertex, n4 } from './xml-utils.ts';
import { TextBlock, type FontSpec } from './text-block.ts';
import type { BodyLine } from '../model/class-model.ts';
import type { NormalizedBodyBlock, NormalizedRichBlock } from '../model/normalized-rich-text.ts';
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '@markdown-viewer/text-measure';
import { createTheme, type Theme } from './theme.ts';
import { separatorStyle, richTextStyle } from './content-types.ts';
import type { ContentBlock, ContentSize, ChildStyleOpts, FinalizeBodyCtx } from './content-types.ts';

// Re-export types so callers can import from block-layout.ts
export type { ContentBlock, ContentSize, ChildStyleOpts, FinalizeBodyCtx };
// Re-export ContentBox and utility functions for convenience
export { separatorStyle, richTextStyle } from './content-types.ts';
export type { ContentBox } from './content-types.ts';

/** Layout metrics baked into a BlockLayout instance */
interface ContentMetrics {
  titleFontSize: number;
  bodyFontSize: number;
  fontFamily: string;
  paddingX: number;
  titlePaddingY: number;
  /** Vertical padding at top and bottom of the body section (below title). */
  bodyPaddingY: number;
  rowHeight: number;
  separatorHeight: number;
  /** Height for titled separators (e.g. map/json titled dividers). */
  titledSeparatorHeight: number;
  minWidth: number;
  minHeight: number;
  /** Extra height added when the content has a title but no body blocks. */
  emptyBodyPad: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default metrics
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULTS: ContentMetrics = {
  titleFontSize: DEFAULT_FONT_SIZE,
  bodyFontSize: DEFAULT_FONT_SIZE,
  fontFamily: DEFAULT_FONT_FAMILY,
  paddingX: 0,
  titlePaddingY: 0,
  bodyPaddingY: 0,
  rowHeight: 26,
  separatorHeight: 8,
  titledSeparatorHeight: 20,
  minWidth: 0,
  minHeight: 0,
  emptyBodyPad: 0,
};



/** Build class metrics from theme. */
function classMetrics(theme: Theme = createTheme()): Partial<ContentMetrics> {
  return {
    paddingX: theme.nodeGap,
    titlePaddingY: theme.titlePadY,
    bodyPaddingY: theme.edgeGap,
    rowHeight: theme.rowH,
    separatorHeight: theme.portSize,
    titledSeparatorHeight: theme.rowH,
    minWidth: theme.titleMinW,
  };
}

/** Build rich body metrics from theme. */
function richBodyMetrics(theme: Theme = createTheme()): Partial<ContentMetrics> {
  // paddingX and bodyPaddingY are intentionally omitted (default 0).
  // RichRenderer.contentPad provides unified four-side content padding.
  return {
    separatorHeight: theme.portSize,
    titledSeparatorHeight: theme.rowH,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Adjust a base separator style for a specific variant and title.
 *
 * Variant effects (based on PlantUML reference rendering):
 *   - solid (--)  → strokeWidth=2  (bold line, thicker than default)
 *   - dotted (..) → dashed=1;dashPattern=1 2
 *   - double (==) → two parallel lines (handled in render for untitled;
 *                    strokeWidth=2 approximation for titled)
 *   - strong (__) → strokeWidth=1  (default thin line, same as class separator)
 *
 * Titled separators: label centered on the line with white background fill.
 */
function adjustSeparatorStyle(
  base: string, variant: string, hasTitle: boolean,
  opts?: { fillColor?: string; strokeColor?: string },
): string {
  let style = base;

  // Apply container stroke color to separator line
  if (opts?.strokeColor) {
    style = style.replace(/strokeColor=[^;]*(;|$)/, `strokeColor=${opts.strokeColor}$1`);
    if (!style.includes('strokeColor=')) style += `strokeColor=${opts.strokeColor};`;
  }

  // Variant-specific stroke overrides
  switch (variant) {
    case 'dotted':
      if (!style.includes('dashed=')) style = style.replace(/;$/, ';dashed=1;dashPattern=1 2;');
      break;
    case 'double':
      // Double line: rendered as two parallel strokes by drawio2svg
      style += 'double=1;';
      break;
    case 'solid':
      // Solid (--) renders slightly bolder than default (official uses stroke-width:1 vs 0.5 default)
      style = style.replace(/strokeWidth=[\d.]+/, (m) => {
        const v = parseFloat(m.split('=')[1]) || 1;
        return `strokeWidth=${n4(v * 1.2)}`;
      });
      break;
    // 'strong' (__) → default strokeWidth, plain separator (no change)
  }

  // Titled separators: center the label on the line with background fill
  if (hasTitle) {
    style = style.replace('labelPosition=right', 'labelPosition=center');
    style = style.replace('align=left', 'align=center');
    const bgColor = opts?.fillColor || '#FFFFFF';
    style += `labelBackgroundColor=${bgColor};`;
  }

  return style;
}

/**
 * Derive a field-level cell id from a raw body line (for port-level edge connections).
 * Strips visibility prefix (+/-/#/~/\*) and extracts the name before ':'.
 */
function deriveRowId(nodeId: string, line: string): string | undefined {
  const stripped = line.replace(/^[+\-#~*]\s*/, '').trim();
  // Handle map entry syntax: "key => value" — use only the key
  const arrowIdx = stripped.indexOf('=>');
  if (arrowIdx >= 0) {
    const key = stripped.slice(0, arrowIdx).trim();
    return key ? `${nodeId}::${key}` : undefined;
  }
  const colonIdx = stripped.indexOf(':');
  const fieldName = colonIdx >= 0 ? stripped.slice(0, colonIdx).trim() : stripped;
  return fieldName ? `${nodeId}::${fieldName}` : undefined;
}

// ── BodyLine helpers ────────────────────────────────────────────────────────

/** Extract the display text from a BodyLine (plain string or tagged object). */
function bodyLineText(l: BodyLine): string {
  return typeof l === 'string' ? l : l.text;
}

/** Extract the PEG-parsed tag (field/method) from a BodyLine, if present. */
function bodyLineTag(l: BodyLine): string | undefined {
  return typeof l === 'string' ? undefined : l.tag;
}

// ── Class body line classification ──────────────────────────────────────────

// Separator patterns (bare and titled)
const RE_CB_SEP_SOLID   = /^-{2,}$/;
const RE_CB_SEP_DOUBLE  = /^={2,}$/;
const RE_CB_SEP_STRONG  = /^_{2,}$/;
const RE_CB_SEP_DOTTED  = /^\.{2,}$/;
const RE_CB_SEP_TITLED_SOLID  = /^--(.+)--$/;
const RE_CB_SEP_TITLED_DOUBLE = /^==(.+)==$/;
const RE_CB_SEP_TITLED_STRONG = /^__(.+)__$/;
const RE_CB_SEP_TITLED_DOTTED = /^\.\.(.+)\.\.$/;

// Table row: | cell | cell |
const RE_CB_TABLE_ROW = /^(?:<#[^>]+>)?\|.+\|$/;

// Tree item: |_ content
const RE_CB_TREE_ITEM = /^\s*\|_\s/;

/**
 * Classify a raw body line and return a separator variant + optional title,
 * or null if it is not a separator.
 */
function classifySeparator(line: string): { variant: string; title?: string } | null {
  if (RE_CB_SEP_SOLID.test(line))  return { variant: 'solid' };
  if (RE_CB_SEP_DOUBLE.test(line)) return { variant: 'double' };
  if (RE_CB_SEP_STRONG.test(line)) return { variant: 'strong' };
  if (RE_CB_SEP_DOTTED.test(line)) return { variant: 'dotted' };
  let m: RegExpMatchArray | null;
  if ((m = line.match(RE_CB_SEP_TITLED_SOLID)))  return { variant: 'solid',  title: m[1].trim() };
  if ((m = line.match(RE_CB_SEP_TITLED_DOUBLE))) return { variant: 'double', title: m[1].trim() };
  if ((m = line.match(RE_CB_SEP_TITLED_STRONG))) return { variant: 'strong', title: m[1].trim() };
  if ((m = line.match(RE_CB_SEP_TITLED_DOTTED))) return { variant: 'dotted', title: m[1].trim() };
  return null;
}

// UML visibility modifier patterns (class body SIMPLE_LINE mode).
// Single-char prefixes: - (private), # (protected), ~ (package), + (public), * (IE_MANDATORY).
// Multi-char prefixes (**, ##, etc.) are NOT valid modifiers — rendered as plain text.
// Space after the prefix is optional (e.g. both "-field" and "- field" are valid).
const RE_VIS_PRIVATE   = /^-([^-].*|$)/;   // - private:   red outlined square
const RE_VIS_PROTECTED = /^#([^#].*|$)/;   // # protected: gold outlined diamond
const RE_VIS_PACKAGE   = /^~([^~].*|$)/;   // ~ package:   blue filled triangle
const RE_VIS_PUBLIC    = /^\+([^+].*|$)/;   // + public:    green filled circle
const RE_VIS_DOT       = /^\*([^*].*|$)/;   // * IE_MANDATORY: black filled circle

// Fixed-width icon slot (0.85em) — keeps all body text left-aligned at the same x.
function iconSlot(inner: string): string {
  return `<span style="display:inline-block;width:0.85em;text-align:center;">${inner}</span>`;
}

// ── Visibility icon HTML (field = hollow, method = filled) ──────────────────

// - private: red square
const VIS_PRIVATE_FIELD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;box-sizing:border-box;' +
  'border:1px solid #C82930;vertical-align:-0.41em;">' +
  '\u200b</span>';
const VIS_PRIVATE_METHOD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;box-sizing:border-box;' +
  'background:#C82930;border:1px solid #C82930;vertical-align:-0.41em;">' +
  '\u200b</span>';

// # protected: gold diamond (rotated 45°)
const VIS_PROTECTED_FIELD =
  '<span style="display:inline-block;width:0.35em;height:0.35em;' +
  'border:1px solid #B38D22;transform:rotate(45deg);vertical-align:-0.49em;">' +
  '\u200b</span>';
const VIS_PROTECTED_METHOD =
  '<span style="display:inline-block;width:0.35em;height:0.35em;' +
  'background:#B38D22;border:1px solid #B38D22;transform:rotate(45deg);vertical-align:-0.49em;">' +
  '\u200b</span>';

// ~ package: blue triangle (▲ via border trick)
const VIS_PACKAGE_FIELD =
  '<span style="display:inline-block;width:0;height:0;' +
  'border-left:0.3em solid transparent;border-right:0.3em solid transparent;' +
  'border-bottom:0.5em solid #4177AF;vertical-align:-0.41em;">' +
  '\u200b</span>';
const VIS_PACKAGE_METHOD =
  '<span style="display:inline-block;width:0;height:0;' +
  'border-left:0.3em solid transparent;border-right:0.3em solid transparent;' +
  'border-bottom:0.5em solid #4177AF;vertical-align:-0.41em;">' +
  '\u200b</span>';

// + public: green circle
const VIS_PUBLIC_FIELD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;box-sizing:border-box;' +
  'border:1px solid #038048;vertical-align:-0.41em;">' +
  '\u200b</span>';
const VIS_PUBLIC_METHOD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;box-sizing:border-box;' +
  'background:#84BE84;border:1px solid #038048;vertical-align:-0.41em;">' +
  '\u200b</span>';

// * IE_MANDATORY: black filled circle (default)
const VIS_DOT_ICON_FILLED =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;' +
  'background:#000000;vertical-align:-0.41em;">' +
  '\u200b</span>';
// * IE_MANDATORY under PlantUML `plain` theme: hollow circle
// (root style cascade: BackgroundColor=white, LineColor=black)
const VIS_DOT_ICON_HOLLOW =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;box-sizing:border-box;' +
  'background:#FFFFFF;border:1px solid #000000;vertical-align:-0.41em;">' +
  '\u200b</span>';

/**
 * Determine if a body line (after stripping visibility prefix) represents a method.
 * When a structured tag is provided (from PEG-parsed {field}/{method}), it takes
 * precedence.  Otherwise falls back to the PlantUML heuristic: '(' or ')' → method.
 */
function isMethodLine(body: string, tag?: string): boolean {
  if (tag === 'method') return true;
  if (tag === 'field') return false;
  return body.includes('(') || body.includes(')');
}

interface VisRule {
  re: RegExp;
  fieldIcon: string;
  methodIcon: string;
  extraSpace?: boolean;
}

/** Build visibility-icon rule set. `ieMandatoryFilled` selects the IE_MANDATORY
 *  dot style (true: filled black dot default; false: hollow dot for plain theme). */
function buildVisRules(ieMandatoryFilled: boolean): VisRule[] {
  const dotIcon = ieMandatoryFilled ? VIS_DOT_ICON_FILLED : VIS_DOT_ICON_HOLLOW;
  return [
    { re: RE_VIS_PRIVATE,   fieldIcon: VIS_PRIVATE_FIELD,   methodIcon: VIS_PRIVATE_METHOD,   extraSpace: true },
    { re: RE_VIS_PROTECTED, fieldIcon: VIS_PROTECTED_FIELD, methodIcon: VIS_PROTECTED_METHOD, extraSpace: true },
    { re: RE_VIS_PACKAGE,   fieldIcon: VIS_PACKAGE_FIELD,   methodIcon: VIS_PACKAGE_METHOD,   extraSpace: true },
    { re: RE_VIS_PUBLIC,    fieldIcon: VIS_PUBLIC_FIELD,     methodIcon: VIS_PUBLIC_METHOD,    extraSpace: true },
    { re: RE_VIS_DOT,       fieldIcon: dotIcon,              methodIcon: dotIcon,              extraSpace: true },
  ];
}

// Default visibility rules (filled IE_MANDATORY dot) — used when no theme provided.
const DEFAULT_VIS_RULES = buildVisRules(true);

/**
 * Process a single member line with inline Creole (SIMPLE_LINE mode — no block-level).
 * When `withIconSlot` is true, every line gets a fixed-width icon slot prefix
 * so all text is left-aligned at the same position.
 * When `showIcons` is false, visibility prefixes are kept as raw text (classAttributeIconSize 0).
 * Optional `tag` (from PEG-parsed {field}/{method}/{static}/{abstract}) overrides the parenthesis heuristic.
 * {static} → underline, {abstract} → italic (matching PlantUML rendering).
 */
function processBodyLine(raw: string, withIconSlot: boolean, showIcons: boolean, font: FontSpec, tag?: string, visRules: VisRule[] = DEFAULT_VIS_RULES): TextBlock {
  if (showIcons) {
    for (const rule of visRules) {
      const m = raw.match(rule.re);
      if (m) {
        const space = rule.extraSpace ? ' ' : '';
        const body = (m[1] || '').replace(/^\s+/, '');
        const icon = isMethodLine(body, tag) ? rule.methodIcon : rule.fieldIcon;
        const bodyBlock = TextBlock.inline(body, font);
        const html = applyMemberModifierStyle(bodyBlock.html, tag);
        return TextBlock.fromHtml(iconSlot(icon) + space + html, font);
      }
    }
  } else {
    // classAttributeIconSize 0: no icons, but keep the visibility char as literal text.
    // We still must strip it from `raw` before creoleInline() to prevent Creole from
    // treating `~` as an escape character (which would silently swallow it).
    for (const rule of visRules) {
      const m = raw.match(rule.re);
      if (m) {
        const visChar = raw[0];
        const body = (m[1] || '').replace(/^\s+/, '');
        const bodyBlock = TextBlock.inline(body, font);
        const html = visChar + applyMemberModifierStyle(bodyBlock.html, tag);
        if (withIconSlot) return TextBlock.fromHtml(iconSlot('\u200b') + ' ' + html, font);
        return TextBlock.fromHtml(html, font);
      }
    }
  }

  const textBlock = TextBlock.inline(raw, font);
  const html = applyMemberModifierStyle(textBlock.html, tag);
  // Non-icon line: add empty icon slot + space for alignment when other lines have icons
  if (withIconSlot) {
    return TextBlock.fromHtml(iconSlot('\u200b') + ' ' + html, font);
  }
  return TextBlock.fromHtml(html, font);
}

/** Wrap HTML with style tags for {static} (underline) and {abstract} (italic). */
function applyMemberModifierStyle(html: string, tag?: string): string {
  if (tag === 'static') return `<u>${html}</u>`;
  if (tag === 'abstract') return `<i>${html}</i>`;
  return html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BlockLayout class
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * BlockLayout — the FULL content of a container, with structural awareness.
 *
 * A BlockLayout may contain multiple blocks (title, body rows, separators,
 * rich text). measure() walks ALL blocks for sizing; renderChildren()
 * outputs child mxCells under a Renderer-owned container.
 *
 * Usage:
 * ```
 * // Structured class body
 * const c = BlockLayout.classBody({ titleHtml, nodeId, attributes, methods });
 * const size = c.measure();  // {width, height, titleHeight}
 * // Renderer creates swimlane container, then:
 * const children = c.renderChildren(nodeId, width, childSkin, size.titleHeight);
 *
 * // Rich note content
 * const c = BlockLayout.richBody(rawLines, { minWidth: 30, ... });
 * const size = c.measure();  // {width, height}
 * // Renderer creates note container, then:
 * const children = c.renderChildren(noteId, width, childSkin);
 * ```
 */
export class BlockLayout {
  private _blocks: ContentBlock[];
  private _m: ContentMetrics;
  /** Theme reference for child style generation in renderChildren. */
  private _theme: Theme;

  private constructor(blocks: ContentBlock[], metrics: Partial<ContentMetrics> = {}, theme: Theme = createTheme()) {
    this._blocks = blocks;
    this._m = { ...DEFAULTS, ...metrics };
    this._theme = theme;
  }

  /**
   * Build the row text style string from theme + child options.
   * Delegates to richTextStyle / textRowStyle depending on portConstraint.
   */
  private _buildRowStyle(co?: ChildStyleOpts): string {
    const fs = this._m.bodyFontSize;
    const ff = this._m.fontFamily;
    const fc = co?.fontColor;
    if (co?.portConstraint) {
      // Swimlane row: textRowStyle style with port constraint
      const sx = co.spacingX ?? this._theme.edgeGap;
      const parts = [
        'text', 'html=1', 'strokeColor=none', 'fillColor=none',
        `align=${co.align ?? 'left'}`, 'verticalAlign=middle',
        `spacingLeft=${sx}`, `spacingRight=${sx}`,
        'whiteSpace=wrap', 'overflow=hidden', 'rotatable=0',
        'points=[[0,0.5],[1,0.5]]', 'portConstraint=eastwest',
      ];
      if (fs) parts.push(`fontSize=${fs}`);
      if (ff) parts.push(`fontFamily=${ff}`);
      if (fc) parts.push(`fontColor=${fc}`);
      if (co.childLineStyle === 'dashed') parts.push('dashed=1');
      else if (co.childLineStyle === 'dotted') parts.push('dashed=1', 'dashPattern=1 2');
      else if (co.childLineStyle === 'bold') parts.push(`strokeWidth=${this._theme.boldStrokeWidth}`);
      return parts.join(';') + ';';
    }
    // Rich body row: richTextStyle
    const sx = co?.spacingX ?? this._theme.edgeGap;
    return richTextStyle(sx, sx, co?.align ?? 'left', fs, ff, fc);
  }

  /**
   * Build the separator style string from theme + child options.
   */
  private _buildSepStyle(co?: ChildStyleOpts): string {
    return separatorStyle({
      strokeWidth: this._theme.strokeWidth,
      fontSize: this._m.bodyFontSize,
      fontFamily: this._m.fontFamily,
      fontColor: co?.fontColor || this._theme.fontColor,
      strokeColor: co?.childStroke || this._theme.colorDark,
      lineStyle: co?.childLineStyle,
      portConstraint: co?.portConstraint,
    });
  }

  /** Expose internal blocks for external consumers (e.g. DOT port-label building). */
  get blocks(): readonly ContentBlock[] {
    return this._blocks;
  }

  // ─── Factories: from pre-processed HTML ────────────────────────────────────

  /**
   * Create structured class node content from raw body lines.
   *
   * Scans body lines and classifies each into:
   *   - Separator (bare or titled) → `kind: 'separator'`
   *   - Table row block (`| ... |`) → `kind: 'rich'` (block-level Creole)
   *   - Tree block (`|_ ...`) → `kind: 'rich'` (block-level Creole)
   *   - Regular member line → `kind: 'row'` (inline Creole, connectable port)
   *
   * In class body context (PlantUML SIMPLE_LINE mode), `*` and `#` are NOT
   * Creole list markers — they are UML visibility modifiers.
   */
  static classBody(opts: {
    titleHtml: string;
    nodeId: string;
    bodyLines?: BodyLine[];
    bodyBlocks?: NormalizedBodyBlock[];
    visibilityIcons?: boolean;
    hideFields?: boolean;
    hideMethods?: boolean;
    /** Font size for title and body text measurement. */
    fontSize?: number;
    /** Font family for text measurement. */
    fontFamily?: string;
    /** Theme — when provided, class metrics are derived from theme. */
    theme?: Theme;
    /**
     * Optional callback to customize body finalization (auto-separator behavior).
     * When provided and returns non-null, replaces the default auto-separator logic.
     * Return a partial ContentMetrics override (e.g. { emptyBodyPad: 10 }) or {}.
     * Return null to fall through to the default auto-separator logic.
     */
    finalizeBody?: (ctx: FinalizeBodyCtx) => Partial<ContentMetrics> | null;
  }): BlockLayout {
    const blocks: ContentBlock[] = [];
    const titleFontSize = opts.fontSize || DEFAULTS.titleFontSize;
    const bodyFontSize = opts.fontSize || DEFAULTS.bodyFontSize;
    const fontFamily = opts.fontFamily || DEFAULTS.fontFamily;
    const titleFont: FontSpec = { size: titleFontSize, family: fontFamily };
    const bodyFont: FontSpec = { size: bodyFontSize, family: fontFamily };
    blocks.push({ kind: 'title', text: TextBlock.fromHtml(opts.titleHtml, titleFont) });

    if (opts.bodyBlocks && opts.bodyBlocks.length > 0) {
      for (const block of opts.bodyBlocks) {
        if (block.kind === 'row') {
          blocks.push({ kind: 'row', text: TextBlock.fromHtml(block.html, bodyFont), id: block.id });
        } else if (block.kind === 'rich') {
          blocks.push({ kind: 'rich', text: TextBlock.fromHtml(block.html, bodyFont) });
        } else {
          blocks.push({ kind: 'separator', variant: block.variant, titleText: block.titleHtml ? TextBlock.fromHtml(block.titleHtml, bodyFont) : undefined });
        }
      }

      if (opts.finalizeBody) {
        const result = opts.finalizeBody({
          blocks,
          lines: opts.bodyLines || [],
          hasSeparator: blocks.some((block) => block.kind === 'separator'),
          hideFields: opts.hideFields,
          hideMethods: opts.hideMethods,
        });
        if (result !== null) {
          const fo: Partial<ContentMetrics> = { ...result };
          if (opts.fontSize) { fo.titleFontSize = opts.fontSize; fo.bodyFontSize = opts.fontSize; }
          if (opts.fontFamily) fo.fontFamily = opts.fontFamily;
          return new BlockLayout(blocks, { ...classMetrics(opts.theme), ...fo });
        }
      }

      const fontOverrides: Partial<ContentMetrics> = {};
      if (opts.fontSize) {
        fontOverrides.titleFontSize = opts.fontSize;
        fontOverrides.bodyFontSize = opts.fontSize;
      }
      if (opts.fontFamily) fontOverrides.fontFamily = opts.fontFamily;
      return new BlockLayout(blocks, { ...classMetrics(opts.theme), ...fontOverrides }, opts.theme);
    }

    const allLines = opts.bodyLines || [];
    const showIcons = opts.visibilityIcons !== false; // default true
    const hideFields = opts.hideFields === true;
    const hideMethods = opts.hideMethods === true;

    // Filter body lines according to hide directives.
    // Separators are always kept so explicit separators remain.
    const lines = (hideFields || hideMethods)
      ? allLines.filter(l => {
          const t = bodyLineText(l).trim();
          // Always keep explicit separators
          if (classifySeparator(t)) return true;
          const tag = bodyLineTag(l);
          const method = isMethodLine(t, tag);
          if (method && hideMethods) return false;
          if (!method && hideFields) return false;
          return true;
        })
      : allLines;
    let i = 0;
    let hasSeparator = false;
    const seenRowIds = new Set<string>(); // track row ids to deduplicate

    // Visibility-icon rules — IE_MANDATORY dot style follows the active theme
    // (plain theme → hollow dot; default → filled dot).
    const visRules = opts.theme ? buildVisRules(opts.theme.ieMandatoryFilled !== false) : DEFAULT_VIS_RULES;

    // Pre-scan: detect if any body lines have a single-char visibility prefix.
    // When true AND icons are enabled, ALL body lines get a fixed-width icon slot.
    const hasVisIcons = showIcons && lines.some(l => {
      const t = bodyLineText(l).trim();
      return visRules.some(r => r.re.test(t));
    });

    while (i < lines.length) {
      const raw = lines[i];
      const line = bodyLineText(raw).trim();
      const tag = bodyLineTag(raw);

      // --- Separator (bare or titled) ---
      const sep = classifySeparator(line);
      if (sep) {
        const titleText = sep.title ? processBodyLine(sep.title, false, showIcons, bodyFont, undefined, visRules) : undefined;
        blocks.push({ kind: 'separator', variant: sep.variant, titleText });
        hasSeparator = true;
        i++;
        continue;
      }

      // --- Table block: collect consecutive | ... | lines ---
      if (RE_CB_TABLE_ROW.test(line)) {
        const tableLines: string[] = [];
        while (i < lines.length && RE_CB_TABLE_ROW.test(bodyLineText(lines[i]).trim())) {
          tableLines.push(bodyLineText(lines[i]).trim());
          i++;
        }
        const text = TextBlock.blockFromLines(tableLines, bodyFont);
        blocks.push({ kind: 'rich', text });
        continue;
      }

      // --- Tree block: collect consecutive |_ lines ---
      if (RE_CB_TREE_ITEM.test(line)) {
        const treeLines: string[] = [];
        while (i < lines.length && RE_CB_TREE_ITEM.test(bodyLineText(lines[i]).trim())) {
          treeLines.push(bodyLineText(lines[i]).trim());
          i++;
        }
        const text = TextBlock.blockFromLines(treeLines, bodyFont);
        blocks.push({ kind: 'rich', text });
        continue;
      }

      // --- Regular member line: inline Creole only ---
      const text = processBodyLine(line, hasVisIcons, showIcons, bodyFont, tag, visRules);
      let rowId = deriveRowId(opts.nodeId, line);
      // Deduplicate: append numeric suffix when id already used
      if (rowId && seenRowIds.has(rowId)) {
        let suffix = 2;
        while (seenRowIds.has(`${rowId}_${suffix}`)) suffix++;
        rowId = `${rowId}_${suffix}`;
      }
      if (rowId) seenRowIds.add(rowId);
      blocks.push({ kind: 'row', text, id: rowId });
      i++;
    }

    // Ensure at least one separator exists (between attributes and methods sections).
    // PlantUML classifies members as fields vs methods: if a line contains '(' or ')'
    // it is a method, otherwise it is a field.  Fields come first, then the separator,
    // then methods.  When no explicit separator is present we insert one automatically.
    //
    // Entity-specific behavior is delegated to the optional finalizeBody callback.
    // When the callback returns non-null, its result overrides the default metrics
    // and the auto-separator logic is skipped entirely.
    if (opts.finalizeBody) {
      const result = opts.finalizeBody({ blocks, lines, hasSeparator, hideFields: opts.hideFields, hideMethods: opts.hideMethods });
      if (result !== null) {
        // Include font overrides so fontSize/fontFamily are applied
        // even when finalizeBody returns early.
        const fo: Partial<ContentMetrics> = { ...result };
        if (opts.fontSize) { fo.titleFontSize = opts.fontSize; fo.bodyFontSize = opts.fontSize; }
        if (opts.fontFamily) fo.fontFamily = opts.fontFamily;
        return new BlockLayout(blocks, { ...classMetrics(opts.theme), ...fo });
      }
    }

    if (!hasSeparator) {
      // Find the range of 'row' blocks (skip title and any rich blocks)
      const rowIndices: number[] = [];
      for (let j = 0; j < blocks.length; j++) {
        if (blocks[j].kind === 'row') rowIndices.push(j);
      }

      // Find the split point: first method that has a preceding field row.
      // Only insert separator when BOTH fields and methods exist.
      let splitIdx = -1;
      let hasFieldRow = false;
      if (rowIndices.length > 0 && lines.length > 0) {
        // Map row blocks back to original lines by scanning non-separator/non-block lines
        let lineIdx = 0;
        for (const ri of rowIndices) {
          // Advance lineIdx past separators / table / tree lines to find the matching raw line
          while (lineIdx < lines.length) {
            const t = bodyLineText(lines[lineIdx]).trim();
            if (classifySeparator(t) || RE_CB_TABLE_ROW.test(t) || RE_CB_TREE_ITEM.test(t)) {
              lineIdx++;
              continue;
            }
            break;
          }
          if (lineIdx < lines.length) {
            const curRaw = lines[lineIdx];
            const curText = bodyLineText(curRaw).trim();
            const curTag = bodyLineTag(curRaw);
            if (isMethodLine(curText, curTag)) {
              if (hasFieldRow) {
                // First method after at least one field — this is the boundary
                splitIdx = ri;
              }
              break;
            }
            hasFieldRow = true;
          }
          lineIdx++;
        }
      }

      // Only insert auto-separator when there is a fields→methods boundary.
      // When all lines are fields-only or methods-only, the swimlane title bar
      // already provides the visual separator — no extra line needed.
      if (splitIdx > 0) {
        // Insert separator between fields and methods
        blocks.splice(splitIdx, 0, { kind: 'separator', variant: 'default' });
      } else if (!hideFields && !hideMethods) {
        // Default behavior (no hide directives): always draw a separator,
        // even when all members are the same type or body is empty.
        if (!hasFieldRow && rowIndices.length > 0) {
          // All rows are methods (no fields before first method) — insert
          // separator BEFORE the first row to create an empty fields section.
          blocks.splice(rowIndices[0], 0, { kind: 'separator', variant: 'default' });
        } else {
          // All rows are fields, or body is empty — separator after all rows.
          blocks.push({ kind: 'separator', variant: 'default' });
        }
      }
    }

    const fontOverrides: Partial<ContentMetrics> = {};
    if (opts.fontSize) {
      fontOverrides.titleFontSize = opts.fontSize;
      fontOverrides.bodyFontSize = opts.fontSize;
    }
    if (opts.fontFamily) fontOverrides.fontFamily = opts.fontFamily;
    return new BlockLayout(blocks, { ...classMetrics(opts.theme), ...fontOverrides }, opts.theme);
  }

  /**
   * Create content from rich block-level HTML (for notes, etc.).
   * Accepts optional min-size configuration so that measure()
   * returns container-ready dimensions.
   */
  static rich(html: string, opts?: {
    minWidth?: number;
    minHeight?: number;
    bodyFontSize?: number;
    fontFamily?: string;
  }): BlockLayout {
    const font: FontSpec = {
      size: opts?.bodyFontSize || DEFAULTS.bodyFontSize,
      family: opts?.fontFamily || DEFAULTS.fontFamily,
    };
    return new BlockLayout([{ kind: 'rich', text: TextBlock.fromHtml(html, font) }], opts);
  }

  /**
   * Create content from normalized rich blocks produced during model normalization.
   * Preserves structural separators while avoiding render-time block parsing.
   */
  static richBlocks(
    richBlocks: NormalizedRichBlock[],
    metrics?: Partial<ContentMetrics>,
    theme?: Theme,
  ): BlockLayout {
    const baseFontSize = metrics?.bodyFontSize ?? DEFAULTS.bodyFontSize;
    const fontFamily = metrics?.fontFamily ?? DEFAULTS.fontFamily;
    const bodyFont: FontSpec = { size: baseFontSize, family: fontFamily };
    const blocks: ContentBlock[] = richBlocks.map((block) => {
      if (block.kind === 'rich') {
        return { kind: 'rich', text: TextBlock.fromHtml(block.html, bodyFont) };
      }
      return {
        kind: 'separator',
        variant: block.variant,
        titleText: block.titleHtml ? TextBlock.fromHtml(block.titleHtml, bodyFont) : undefined,
      };
    });
    return new BlockLayout(blocks, { ...richBodyMetrics(theme), ...metrics }, theme);
  }

  /**
   * Bracket body (participant / node / rect / file / person): block-level Creole
   * with structural separator extraction.
   *
   * Unlike block(), this factory preserves separators as `kind: 'separator'`
   * blocks so that render() can draw them as proper DrawIO line mxCells
   * instead of embedding <hr> in HTML.
   */
  static bracketBody(lines: string[], metrics?: Partial<ContentMetrics>, theme?: Theme): BlockLayout {
    return BlockLayout.richBody(lines, metrics, theme);
  }

  /**
   * Rich body: block-level Creole processing with structural separator
   * extraction.
   *
   * Splits input lines at separator boundaries:
   *   - Separator lines → `kind: 'separator'` with variant + optional title
   *   - Runs of non-separator lines → parseCreoleBlocks → renderCreoleToHtml
   *     → `kind: 'rich'`
   *
   * The resulting BlockLayout produces container + child mxCells in render(),
   * with separators drawn as proper DrawIO `line` elements.
   */
  static richBody(rawLines: string[], metrics?: Partial<ContentMetrics>, theme?: Theme): BlockLayout {
    const blocks: ContentBlock[] = [];
    const buffer: string[] = [];
    let inCode = false; // track <code> blocks to suppress separator detection
    const baseFontSize = metrics?.bodyFontSize ?? DEFAULTS.bodyFontSize;
    const fontFamily = metrics?.fontFamily ?? DEFAULTS.fontFamily;
    const bodyFont: FontSpec = { size: baseFontSize, family: fontFamily };

    function flushBuffer() {
      if (buffer.length > 0) {
        const text = TextBlock.blockFromLines(buffer, bodyFont);
        blocks.push({ kind: 'rich', text });
        buffer.length = 0;
      }
    }

    for (const rawLine of rawLines) {
      const line = TextBlock.decodeEscapes(rawLine);
      const trimmed = line.trim();

      // Track <code> / </code> boundaries — no separator detection inside code blocks
      if (!inCode && /^<code>$/i.test(trimmed)) {
        inCode = true;
        buffer.push(line);
        continue;
      }
      if (inCode) {
        buffer.push(line);
        if (/^<\/code>$/i.test(trimmed)) inCode = false;
        continue;
      }

      const sep = classifySeparator(trimmed);
      if (sep) {
        flushBuffer();
        const titleText = sep.title
          ? TextBlock.inlineCreole(sep.title, bodyFont)
          : undefined;
        blocks.push({ kind: 'separator', variant: sep.variant, titleText });
      } else {
        buffer.push(line);
      }
    }
    flushBuffer();

    return new BlockLayout(blocks, { ...richBodyMetrics(theme), ...metrics }, theme);
  }

  // ─── Measure ───────────────────────────────────────────────────────────────

  /**
   * Compute content dimensions by walking ALL blocks structurally.
   *
   * - title: b.text.measure() + paddingX + titlePaddingY
   * - row: b.text.measure() for width; measured height + bodyPaddingY for height
   * - separator: fixed separatorHeight
   * - rich: b.text.measure() + paddingX
   *
   * Returns { width, height, titleHeight? }.
   * titleHeight is set when the content has a title block (for swimlane startSize).
   */
  measure(): ContentSize {
    let width = 0;
    let height = 0;
    let titleHeight: number | undefined;

    for (const b of this._blocks) {
      switch (b.kind) {
        case 'title': {
          const m = b.text.measure();
          const th = Math.ceil(m.height) + this._m.titlePaddingY;
          width = Math.max(width, Math.ceil(m.width) + this._m.paddingX);
          titleHeight = th;
          height += th;
          break;
        }
        case 'row': {
          const m = b.text.measure();
          width = Math.max(width, Math.ceil(m.width) + this._m.paddingX);
          height += Math.ceil(m.height) + this._m.bodyPaddingY;
          break;
        }
        case 'separator': {
          const sh = b.titleText ? this._m.titledSeparatorHeight : this._m.separatorHeight;
          height += sh;
          if (b.titleText) {
            const m = b.titleText.measure();
            width = Math.max(width, Math.ceil(m.width) + this._m.paddingX);
          }
          break;
        }
        case 'rich': {
          const m = b.text.measure();
          width = Math.max(width, Math.ceil(m.width) + this._m.paddingX);
          height += Math.ceil(m.height);
          break;
        }
      }
    }

    width = Math.max(width, this._m.minWidth);
    if (this._m.minHeight) height = Math.max(height, this._m.minHeight);

    // Add body padding (top + bottom) when there are non-title blocks
    const hasBody = this._blocks.some(b => b.kind !== 'title');
    if (hasBody && this._m.bodyPaddingY) {
      height += this._m.bodyPaddingY * 2;
    } else if (!hasBody && this._m.emptyBodyPad) {
      // Title-only content: add a small empty body area (e.g. empty objects)
      height += this._m.emptyBodyPad;
    }

    return { width, height, titleHeight };
  }

  /**
   * Compute port positions for row blocks that have an id.
   * Uses the same layout logic as measure() so y offsets are consistent.
   */
  portPositions(): Array<{ id: string; y: number; height: number }> {
    const ports: Array<{ id: string; y: number; height: number }> = [];
    let y = 0;
    let bodyStarted = false;

    for (const b of this._blocks) {
      switch (b.kind) {
        case 'title': {
          const m = b.text.measure();
          y += Math.ceil(m.height) + this._m.titlePaddingY;
          break;
        }
        case 'row': {
          if (!bodyStarted && this._m.bodyPaddingY > 0) {
            y += this._m.bodyPaddingY;
            bodyStarted = true;
          }
          const m = b.text.measure();
          const h = Math.ceil(m.height) + this._m.bodyPaddingY;
          if (b.id) {
            ports.push({ id: b.id, y, height: h });
          }
          y += h;
          break;
        }
        case 'separator': {
          if (!bodyStarted && this._m.bodyPaddingY > 0) {
            y += this._m.bodyPaddingY;
            bodyStarted = true;
          }
          y += b.titleText ? this._m.titledSeparatorHeight : this._m.separatorHeight;
          break;
        }
        case 'rich': {
          if (!bodyStarted && this._m.bodyPaddingY > 0) {
            y += this._m.bodyPaddingY;
            bodyStarted = true;
          }
          const m = b.text.measure();
          y += Math.ceil(m.height);
          break;
        }
      }
    }

    return ports;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  // ─── Render children ────────────────────────────────────────────────────

  /**
   * Render body blocks (row / rich / separator) as child mxCells under a
   * container created by the caller.  Title blocks are skipped — the caller
   * is responsible for embedding the title in the container cell.
   *
   * Style generation is handled internally when the BlockLayout holds a theme.
   * Pass ChildStyleOpts to fine-tune (e.g. portConstraint for swimlanes,
   * fillColor/strokeColor for separator label backgrounds).
   *
   * @param parentId — id of the container mxCell
   * @param width    — container width (children are full-width)
   * @param opts     — child style options (fillColor, strokeColor, portConstraint, etc.)
   * @param startY   — initial y offset (e.g. titleHeight for swimlanes)
   * @param startX   — initial x offset (e.g. ellipse shape padding)
   */
  renderChildren(parentId: string, width: number, opts?: ChildStyleOpts, startY = 0, startX = 0): string[] {
    const rowStyle = this._buildRowStyle(opts);
    const baseSepStyle = this._buildSepStyle(opts);
    const fillColor = opts?.fillColor;
    const strokeColor = opts?.strokeColor;
    const cells: string[] = [];
    let y = startY + this._m.bodyPaddingY;
    const x = startX || undefined; // omit when 0 for compact XML

    for (const b of this._blocks) {
      if (b.kind === 'title') continue;

      if (b.kind === 'row') {
        const m = b.text.measure();
        const h = Math.ceil(m.height) + this._m.bodyPaddingY;
        cells.push(mxVertex({
          id: b.id,
          value: b.text.html,
          style: rowStyle,
          parent: parentId,
          x,
          y,
          width,
          height: h,
        }));
        y += h;
      } else if (b.kind === 'separator') {
        const sepHeight = b.titleText ? this._m.titledSeparatorHeight : this._m.separatorHeight;
        const sepStyle = adjustSeparatorStyle(
          baseSepStyle, b.variant, !!b.titleText,
          { fillColor, strokeColor },
        );
        const bounds = opts?.separatorBounds?.(y + sepHeight / 2);
        cells.push(mxVertex({
          value: b.titleText?.html || '',
          style: sepStyle,
          parent: parentId,
          x: bounds?.x ?? x,
          y,
          width: bounds?.width ?? width,
          height: sepHeight,
        }));
        y += sepHeight;
      } else if (b.kind === 'rich') {
        const m = b.text.measure();
        const h = Math.ceil(m.height);
        cells.push(mxVertex({
          value: b.text.html,
          style: rowStyle,
          parent: parentId,
          x,
          y,
          width,
          height: h,
        }));
        y += h;
      }
    }

    return cells;
  }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  /** Whether the content contains separator blocks. */
  get hasSeparators(): boolean {
    return this._blocks.some(b => b.kind === 'separator');
  }

  /** Title HTML (for swimlane containers that need startSize). */
  get titleHtml(): string {
    const b = this._blocks.find(b => b.kind === 'title');
    return b && b.kind === 'title' ? b.text.html : '';
  }

  /** Combined HTML value (backward compatibility for model fields). */
  get html(): string {
    return this._blocks
      .filter(b => b.kind !== 'separator')
      .map(b => (b as { text: TextBlock }).text.html)
      .join('');
  }

  /** String coercion — returns finalized HTML. */
  toString(): string {
    return this.html;
  }
}
