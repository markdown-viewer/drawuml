/**
 * Unified content module — SINGLE source of truth for ALL PlantUML text →
 * DrawIO content processing and measurement.
 *
 * Exposes ONE class `Content` with three interfaces:
 *
 *   1. **Load**           — factory methods create Content from raw/processed text
 *   2. **Measure**        — `content.measure()` — structural content-aware sizing
 *   3. **RenderChildren** — `content.renderChildren(parentId, width, skin)` —
 *                           child mxCells (rows, separators, rich blocks) under
 *                           a container created by the Renderer
 *
 * Container creation (outer shape / border) is the Renderer's responsibility.
 * Content only generates interior child cells.
 *
 * Internal pipeline (for raw text factories):
 *   1. unescapePlantUml  — PlantUML escape sequences
 *   2. creoleInline       — Creole inline markup (**bold**, //italic//, etc.)
 *   3. parseCreoleBlocks  — Block-level structure (headings, lists, tables, …)
 *   4. renderCreoleToHtml — Block AST → semantic HTML
 *   5. finalizeHtml       — \n → <br> (outside <pre>), XHTML normalization
 */

import { measureText } from '@markdown-viewer/text-measure';
import { mxVertex } from './xml-utils.ts';
import { unescapePlantUml } from './puml-unescape.ts';
import { creoleInline } from './creole-inline.ts';
import { parseCreoleBlocks } from './creole-parser.ts';
import { renderCreoleToHtml } from './creole-render.ts';
import type { BodyLine } from '../model/class-model.ts';
// Default font metrics for text measurement (local constants to avoid theme.ts dependency)
const DEFAULT_FONT_FAMILY = 'Arial';
const DEFAULT_FONT_SIZE = 12;

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Internal content block */
export type ContentBlock =
  | { kind: 'title'; html: string }
  | { kind: 'row'; html: string; id?: string }
  | { kind: 'separator'; variant: string; title?: string }
  | { kind: 'rich'; html: string };

/** Layout metrics baked into a Content instance */
interface ContentMetrics {
  titleFontSize: number;
  bodyFontSize: number;
  paddingX: number;
  paddingY: number;
  titlePaddingY: number;
  /** Vertical padding at top and bottom of the body section (below title). */
  bodyPaddingY: number;
  rowHeight: number;
  separatorHeight: number;
  minWidth: number;
  minHeight: number;
  /** Extra height added when the content has a title but no body blocks. */
  emptyBodyPad: number;
}

/** Measured content dimensions */
export interface ContentSize {
  width: number;
  height: number;
  /** Title block height (for swimlane startSize). Only set for structured content. */
  titleHeight?: number;
}

/** Parent container geometry for rendering */
export interface ContentBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Center position of external xlabel label in DrawIO coordinates, if any. */
  xlabelPos?: { x: number; y: number };
}

/** DrawIO rendering styles for child cells inside a container */
export interface ChildSkin {
  /** DrawIO style for body text row / rich child mxCells */
  rowStyle: string;
  /** DrawIO style for separator child mxCells */
  separatorStyle: string;
  /** Container fill color — used for separator label background */
  fillColor?: string;
  /** Container stroke color — used for separator line color */
  strokeColor?: string;
}

/**
 * Context passed to the finalizeBody callback in Content.classBody().
 * Allows renderers to customize auto-separator behavior per entity type
 * without Content needing to know about specific entity types.
 */
export interface FinalizeBodyCtx {
  /** Mutable content blocks — callback may modify in-place. */
  blocks: ContentBlock[];
  /** Processed body lines (after filtering). */
  lines: BodyLine[];
  /** Whether an explicit separator was found in body lines. */
  hasSeparator: boolean;
  hideFields?: boolean;
  hideMethods?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default metrics
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULTS: ContentMetrics = {
  titleFontSize: 12,
  bodyFontSize: DEFAULT_FONT_SIZE,
  paddingX: 0,
  paddingY: 0,
  titlePaddingY: 0,
  bodyPaddingY: 0,
  rowHeight: 26,
  separatorHeight: 8,
  minWidth: 0,
  minHeight: 0,
  emptyBodyPad: 0,
};

// Exported structural constants for consumers (e.g. DOT port-label building)
export const CLASS_ROW_HEIGHT = 22;
export const CLASS_SEPARATOR_HEIGHT = 10;
export const CLASS_BODY_PADDING_Y = 5;
export const TITLED_SEPARATOR_HEIGHT = 20;

const CLASS_METRICS: Partial<ContentMetrics> = {
  titleFontSize: 12,
  paddingX: 40,
  titlePaddingY: 12,
  bodyPaddingY: CLASS_BODY_PADDING_Y,
  rowHeight: CLASS_ROW_HEIGHT,
  separatorHeight: CLASS_SEPARATOR_HEIGHT,
  minWidth: 80,
};

const RICH_BODY_METRICS: Partial<ContentMetrics> = {
  paddingX: 22,   // spacingLeft + spacingRight + 2 (drawio2svg subtracts 2 extra)
  bodyPaddingY: 5, // top/bottom padding — matches separator half-height (10/2)
  separatorHeight: CLASS_SEPARATOR_HEIGHT,
};

/**
 * Build a DrawIO style string for rich text child cells.
 *
 * All rich body renderers (participant, bracket-node, note, legend) share the
 * same base style with `verticalAlign=middle`.  Using middle alignment avoids
 * drawio2svg's fixed 7px top offset that affects `verticalAlign=top` +
 * `whiteSpace=wrap` cells.  When cell height equals measuredH the visual
 * result is identical to top alignment.
 * Only `spacingLeft` / `spacingRight` vary per consumer.
 */
export function richTextStyle(spacingLeft: number, spacingRight: number, align: 'left' | 'center' | 'right' = 'left'): string {
  return [
    'text', 'html=1', 'strokeColor=none', 'fillColor=none',
    `align=${align}`, 'verticalAlign=middle',
    `spacingLeft=${spacingLeft}`, `spacingRight=${spacingRight}`,
    'whiteSpace=wrap', 'overflow=hidden', 'rotatable=0',
  ].join(';') + ';';
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
      style = style.replace(/strokeWidth=\d+/, 'strokeWidth=1.2');
      break;
    // 'strong' (__) → default strokeWidth=1, plain separator (no change)
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
 * Finalize semantic HTML for DrawIO:
 *   - Convert \n → <br> ONLY outside <pre>…</pre> blocks
 *   - Normalize via DOMParser → well-formed XHTML
 */
function finalizeHtml(html: string): string {
  // Protect <pre>…</pre> blocks from \n→<br> conversion
  const preBlocks: string[] = [];
  let s = html.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, (match) => {
    preBlocks.push(match);
    return `\x00PRE${preBlocks.length - 1}\x00`;
  });

  s = s.replace(/\n/g, '<br>');

  for (let i = 0; i < preBlocks.length; i++) {
    s = s.replace(`\x00PRE${i}\x00`, preBlocks[i]);
  }

  // Normalize via DOMParser → well-formed XHTML
  const doc = new DOMParser().parseFromString(s, 'text/html');
  const body = doc.getElementsByTagName('body')[0];
  const serializer = new XMLSerializer();
  let xhtml = serializer.serializeToString(body);
  const idx = xhtml.indexOf('>');
  if (idx !== -1) xhtml = xhtml.slice(idx + 1);
  if (xhtml.endsWith('</body>')) xhtml = xhtml.slice(0, -7);
  xhtml = xhtml.replace(/ xmlns="[^"]*"/g, '');
  return xhtml;
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

// * IE_MANDATORY: black filled circle (always filled)
const VIS_DOT_ICON =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;' +
  'background:#000000;vertical-align:-0.41em;">' +
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

/** All single-char visibility regex + icon pairs, checked in order. */
const VIS_RULES: Array<{ re: RegExp; fieldIcon: string; methodIcon: string; extraSpace?: boolean }> = [
  { re: RE_VIS_PRIVATE,   fieldIcon: VIS_PRIVATE_FIELD,   methodIcon: VIS_PRIVATE_METHOD,   extraSpace: true },
  { re: RE_VIS_PROTECTED, fieldIcon: VIS_PROTECTED_FIELD, methodIcon: VIS_PROTECTED_METHOD, extraSpace: true },
  { re: RE_VIS_PACKAGE,   fieldIcon: VIS_PACKAGE_FIELD,   methodIcon: VIS_PACKAGE_METHOD,   extraSpace: true },
  { re: RE_VIS_PUBLIC,    fieldIcon: VIS_PUBLIC_FIELD,     methodIcon: VIS_PUBLIC_METHOD,    extraSpace: true },
  { re: RE_VIS_DOT,       fieldIcon: VIS_DOT_ICON,        methodIcon: VIS_DOT_ICON,         extraSpace: true },
];

/**
 * Process a single member line with inline Creole (SIMPLE_LINE mode — no block-level).
 * When `withIconSlot` is true, every line gets a fixed-width icon slot prefix
 * so all text is left-aligned at the same position.
 * When `showIcons` is false, visibility prefixes are kept as raw text (classAttributeIconSize 0).
 * Optional `tag` (from PEG-parsed {field}/{method}/{static}/{abstract}) overrides the parenthesis heuristic.
 * {static} → underline, {abstract} → italic (matching PlantUML rendering).
 */
function processBodyLine(raw: string, withIconSlot: boolean, showIcons: boolean, tag?: string): string {
  if (showIcons) {
    for (const rule of VIS_RULES) {
      const m = raw.match(rule.re);
      if (m) {
        const space = rule.extraSpace ? ' ' : '';
        const body = (m[1] || '').replace(/^\s+/, '');
        const icon = isMethodLine(body, tag) ? rule.methodIcon : rule.fieldIcon;
        let html = creoleInline(unescapePlantUml(body));
        html = applyMemberModifierStyle(html, tag);
        return finalizeHtml(iconSlot(icon) + space + html);
      }
    }
  } else {
    // classAttributeIconSize 0: no icons, but keep the visibility char as literal text.
    // We still must strip it from `raw` before creoleInline() to prevent Creole from
    // treating `~` as an escape character (which would silently swallow it).
    for (const rule of VIS_RULES) {
      const m = raw.match(rule.re);
      if (m) {
        const visChar = raw[0];
        const body = (m[1] || '').replace(/^\s+/, '');
        let html = visChar + creoleInline(unescapePlantUml(body));
        html = applyMemberModifierStyle(html, tag);
        if (withIconSlot) return finalizeHtml(iconSlot('\u200b') + ' ' + html);
        return finalizeHtml(html);
      }
    }
  }

  let textHtml = creoleInline(unescapePlantUml(raw));
  textHtml = applyMemberModifierStyle(textHtml, tag);
  // Non-icon line: add empty icon slot + space for alignment when other lines have icons
  if (withIconSlot) {
    return finalizeHtml(iconSlot('\u200b') + ' ' + textHtml);
  }
  return finalizeHtml(textHtml);
}

/** Wrap HTML with style tags for {static} (underline) and {abstract} (italic). */
function applyMemberModifierStyle(html: string, tag?: string): string {
  if (tag === 'static') return `<u>${html}</u>`;
  if (tag === 'abstract') return `<i>${html}</i>`;
  return html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Content class
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Content — the FULL content of a container, with structural awareness.
 *
 * A Content may contain multiple blocks (title, body rows, separators,
 * rich text). measure() walks ALL blocks for sizing; renderChildren()
 * outputs child mxCells under a Renderer-owned container.
 *
 * Usage:
 * ```
 * // Structured class body
 * const c = Content.classBody({ titleHtml, nodeId, attributes, methods });
 * const size = c.measure();  // {width, height, titleHeight}
 * // Renderer creates swimlane container, then:
 * const children = c.renderChildren(nodeId, width, childSkin, size.titleHeight);
 *
 * // Rich note content
 * const c = Content.richBody(rawLines, { paddingX: 23, paddingY: 10, ... });
 * const size = c.measure();  // {width, height}
 * // Renderer creates note container, then:
 * const children = c.renderChildren(noteId, width, childSkin);
 * ```
 */
export class Content {
  private _blocks: ContentBlock[];
  private _m: ContentMetrics;

  private constructor(blocks: ContentBlock[], metrics: Partial<ContentMetrics> = {}) {
    this._blocks = blocks;
    this._m = { ...DEFAULTS, ...metrics };
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
    visibilityIcons?: boolean;
    hideFields?: boolean;
    hideMethods?: boolean;
    /**
     * Optional callback to customize body finalization (auto-separator behavior).
     * When provided and returns non-null, replaces the default auto-separator logic.
     * Return a partial ContentMetrics override (e.g. { emptyBodyPad: 10 }) or {}.
     * Return null to fall through to the default auto-separator logic.
     */
    finalizeBody?: (ctx: FinalizeBodyCtx) => Partial<ContentMetrics> | null;
  }): Content {
    const blocks: ContentBlock[] = [];
    blocks.push({ kind: 'title', html: opts.titleHtml });

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

    // Pre-scan: detect if any body lines have a single-char visibility prefix.
    // When true AND icons are enabled, ALL body lines get a fixed-width icon slot.
    const hasVisIcons = showIcons && lines.some(l => {
      const t = bodyLineText(l).trim();
      return VIS_RULES.some(r => r.re.test(t));
    });

    while (i < lines.length) {
      const raw = lines[i];
      const line = bodyLineText(raw).trim();
      const tag = bodyLineTag(raw);

      // --- Separator (bare or titled) ---
      const sep = classifySeparator(line);
      if (sep) {
        const title = sep.title ? processBodyLine(sep.title, false, showIcons) : undefined;
        blocks.push({ kind: 'separator', variant: sep.variant, title });
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
        const tableBlocks = parseCreoleBlocks(tableLines);
        const html = finalizeHtml(renderCreoleToHtml(tableBlocks));
        blocks.push({ kind: 'rich', html });
        continue;
      }

      // --- Tree block: collect consecutive |_ lines ---
      if (RE_CB_TREE_ITEM.test(line)) {
        const treeLines: string[] = [];
        while (i < lines.length && RE_CB_TREE_ITEM.test(bodyLineText(lines[i]).trim())) {
          treeLines.push(bodyLineText(lines[i]).trim());
          i++;
        }
        const treeBlocks = parseCreoleBlocks(treeLines);
        const html = finalizeHtml(renderCreoleToHtml(treeBlocks));
        blocks.push({ kind: 'rich', html });
        continue;
      }

      // --- Regular member line: inline Creole only ---
      const html = processBodyLine(line, hasVisIcons, showIcons, tag);
      blocks.push({ kind: 'row', html, id: deriveRowId(opts.nodeId, line) });
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
        return new Content(blocks, { ...CLASS_METRICS, ...result });
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

    return new Content(blocks, CLASS_METRICS);
  }

  /**
   * Create content from rich block-level HTML (for notes, etc.).
   * Accepts optional padding / min-size configuration so that measure()
   * returns container-ready dimensions.
   */
  static rich(html: string, opts?: {
    paddingX?: number;
    paddingY?: number;
    minWidth?: number;
    minHeight?: number;
  }): Content {
    return new Content([{ kind: 'rich', html }], opts);
  }

  /**
   * Create content from pre-processed HTML (labels, messages, etc.).
   */
  static text(html: string, opts?: { fontSize?: number }): Content {
    const metrics: Partial<ContentMetrics> = {};
    if (opts?.fontSize != null) metrics.bodyFontSize = opts.fontSize;
    return new Content([{ kind: 'rich', html }], metrics);
  }

  // ─── Factories: from raw PlantUML text ─────────────────────────────────────

  /**
   * Single-line inline Creole processing.
   * Pipeline: unescapePlantUml → creoleInline → finalizeHtml
   */
  static inline(raw: string): Content {
    const html = finalizeHtml(creoleInline(unescapePlantUml(raw)));
    return Content.text(html);
  }

  /**
   * Multi-line block-level Creole processing.
   * Pipeline: unescapePlantUml → parseCreoleBlocks → renderCreoleToHtml → finalizeHtml
   */
  static block(raw: string): Content {
    const unescaped = unescapePlantUml(raw);
    const lines = unescaped.split('\n');
    const blocks = parseCreoleBlocks(lines);
    const html = finalizeHtml(renderCreoleToHtml(blocks));
    return Content.rich(html);
  }

  /**
   * Bracket body (participant / node / rect / file / person): block-level Creole
   * with structural separator extraction.
   *
   * Unlike block(), this factory preserves separators as `kind: 'separator'`
   * blocks so that render() can draw them as proper DrawIO line mxCells
   * instead of embedding <hr> in HTML.
   */
  static bracketBody(lines: string[], metrics?: Partial<ContentMetrics>): Content {
    return Content.richBody(lines, metrics);
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
   * The resulting Content produces container + child mxCells in render(),
   * with separators drawn as proper DrawIO `line` elements.
   */
  static richBody(rawLines: string[], metrics?: Partial<ContentMetrics>): Content {
    const blocks: ContentBlock[] = [];
    const buffer: string[] = [];
    let inCode = false; // track <code> blocks to suppress separator detection

    function flushBuffer() {
      if (buffer.length > 0) {
        const unescaped = buffer.map(l => unescapePlantUml(l));
        const ast = parseCreoleBlocks(unescaped);
        const html = finalizeHtml(renderCreoleToHtml(ast));
        blocks.push({ kind: 'rich', html });
        buffer.length = 0;
      }
    }

    for (const line of rawLines) {
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
        const title = sep.title
          ? finalizeHtml(creoleInline(unescapePlantUml(sep.title)))
          : undefined;
        blocks.push({ kind: 'separator', variant: sep.variant, title });
      } else {
        buffer.push(line);
      }
    }
    flushBuffer();

    return new Content(blocks, { ...RICH_BODY_METRICS, ...metrics });
  }

  // ─── Measure ───────────────────────────────────────────────────────────────

  /**
   * Compute content dimensions by walking ALL blocks structurally.
   *
   * - title: measureText(html, titleFontSize) + paddingX + titlePaddingY
   * - row: measureText(html, bodyFontSize) for width; fixed rowHeight for height
   * - separator: fixed separatorHeight
   * - rich: measureText(html, bodyFontSize) + paddingX + paddingY
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
          const m = measureText(b.html, this._m.titleFontSize, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
          const th = Math.ceil(m.height) + this._m.titlePaddingY;
          width = Math.max(width, Math.ceil(m.width) + this._m.paddingX);
          titleHeight = th;
          height += th;
          break;
        }
        case 'row': {
          const m = measureText(b.html, this._m.bodyFontSize, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
          width = Math.max(width, Math.ceil(m.width) + this._m.paddingX);
          height += Math.ceil(m.height) + this._m.bodyPaddingY;
          break;
        }
        case 'separator': {
          const sh = b.title ? TITLED_SEPARATOR_HEIGHT : this._m.separatorHeight;
          height += sh;
          if (b.title) {
            const m = measureText(b.title, this._m.bodyFontSize, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
            width = Math.max(width, Math.ceil(m.width) + this._m.paddingX);
          }
          break;
        }
        case 'rich': {
          const m = measureText(b.html, this._m.bodyFontSize, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
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

  // ─── Render ────────────────────────────────────────────────────────────────

  // ─── Render children ────────────────────────────────────────────────────

  /**
   * Render body blocks (row / rich / separator) as child mxCells under a
   * container created by the caller.  Title blocks are skipped — the caller
   * is responsible for embedding the title in the container cell.
   *
   * @param parentId — id of the container mxCell
   * @param width    — container width (children are full-width)
   * @param skin     — child cell styles
   * @param startY   — initial y offset (e.g. titleHeight for swimlanes)
   */
  renderChildren(parentId: string, width: number, skin: ChildSkin, startY = 0): string[] {
    const cells: string[] = [];
    let y = startY + this._m.bodyPaddingY;

    for (const b of this._blocks) {
      if (b.kind === 'title') continue;

      if (b.kind === 'row') {
        const m = measureText(b.html, this._m.bodyFontSize, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
        const h = Math.ceil(m.height) + this._m.bodyPaddingY;
        cells.push(mxVertex({
          id: b.id,
          value: b.html,
          style: skin.rowStyle,
          parent: parentId,
          y,
          width,
          height: h,
        }));
        y += h;
      } else if (b.kind === 'separator') {
        const sepHeight = b.title ? TITLED_SEPARATOR_HEIGHT : this._m.separatorHeight;
        const sepStyle = adjustSeparatorStyle(
          skin.separatorStyle, b.variant, !!b.title,
          { fillColor: skin.fillColor, strokeColor: skin.strokeColor },
        );
        cells.push(mxVertex({
          value: b.title || '',
          style: sepStyle,
          parent: parentId,
          y,
          width,
          height: sepHeight,
        }));
        y += sepHeight;
      } else if (b.kind === 'rich') {
        const m = measureText(b.html, this._m.bodyFontSize, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
        const h = Math.ceil(m.height);
        cells.push(mxVertex({
          value: b.html,
          style: skin.rowStyle,
          parent: parentId,
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
    return b ? (b as { kind: 'title'; html: string }).html : '';
  }

  /** Combined HTML value (backward compatibility for model fields). */
  get html(): string {
    if (this._blocks.length === 1) {
      return (this._blocks[0] as any).html || '';
    }
    return this._blocks
      .filter(b => b.kind !== 'separator')
      .map(b => (b as any).html || '')
      .join('');
  }

  /** String coercion — returns finalized HTML. */
  toString(): string {
    return this.html;
  }
}
