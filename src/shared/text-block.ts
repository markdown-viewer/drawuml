/**
 * TextBlock — immutable text processing unit.
 *
 * Encapsulates the full pipeline: raw text → Creole/unescape → HTML → measurement.
 * Guarantees that measure() and .html always refer to the same internal string.
 *
 * Public surface:
 *   - Factory: TextBlock.inline(), TextBlock.block(), TextBlock.literal()
 *   - Output:  .html (readonly)
 *   - Size:    .measure(), .width, .height
 *
 * All pipeline functions (creoleInline, finalizeHtml, etc.) are module-internal
 * and NOT re-exported.  External code can only access them through TextBlock factories.
 */

import { measureText, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '@markdown-viewer/text-measure';

// ═══════════════════════════════════════════════════════════════════════════════
// Public types
// ═══════════════════════════════════════════════════════════════════════════════

export interface FontSpec {
  readonly size: number;
  readonly family: string;
  readonly weight?: string;
  readonly style?: string;
}

export interface TextSize {
  readonly width: number;
  readonly height: number;
}

/** Default font spec matching Content defaults. */
export const DEFAULT_FONT: FontSpec = { size: DEFAULT_FONT_SIZE, family: DEFAULT_FONT_FAMILY };

// ═══════════════════════════════════════════════════════════════════════════════
// TextBlock
// ═══════════════════════════════════════════════════════════════════════════════

export class TextBlock {
  private readonly _html: string;
  private readonly _measureInput: string;
  private readonly _font: FontSpec;
  private readonly _measureAsHtml: boolean;
  private _size: TextSize | null = null;

  private constructor(
    html: string,
    font: FontSpec,
    measureAsHtml: boolean,
    measureInput?: string,
  ) {
    this._html = html;
    this._font = font;
    this._measureAsHtml = measureAsHtml;
    this._measureInput = measureInput ?? html;
  }

  // ── Factory methods ──────────────────────────────────────────────────────

  /**
   * Single-line Creole text → HTML.
   * Pipeline: unescapePlantUml → creoleInline → finalizeHtml
   */
  static inline(raw: string, font: FontSpec): TextBlock {
    const html = finalizeHtml(creoleInline(unescapePlantUml(raw)));
    return new TextBlock(html, font, true);
  }

  /**
   * Multi-line block-level Creole text → HTML.
   * Pipeline: unescapePlantUml → parseCreoleBlocks → renderCreoleToHtml → finalizeHtml
   */
  static block(raw: string, font: FontSpec): TextBlock {
    const unescaped = unescapePlantUml(raw);
    const lines = unescaped.split('\n');
    const blocks = parseCreoleBlocks(lines);
    const html = finalizeHtml(renderCreoleToHtml(blocks, font.size));
    return new TextBlock(html, font, true);
  }

  /**
   * Literal text (no Creole processing).
   * For labels that must keep literal semantics (map entries, port labels, etc.).
   */
  static literal(text: string, font: FontSpec): TextBlock {
    // Keep output text unchanged for downstream XML escaping, but measure as
    // HTML-safe literal to avoid branch heuristics and entity-width skew.
    return new TextBlock(text, font, true, escapeHtmlText(text));
  }

  /**
   * Pre-processed HTML (no Creole, no unescape).
   * For HTML strings already produced by buildTitleHtml / buildLabelHtml etc.
   */
  static fromHtml(html: string, font: FontSpec): TextBlock {
    return new TextBlock(html, font, true);
  }

  /**
   * Inline Creole on already-unescaped text.
   * Pipeline: creoleInline → finalizeHtml (NO unescapePlantUml).
   * For text that was pre-unescaped by the caller (e.g. separator titles in richBody).
   */
  static inlineCreole(text: string, font: FontSpec): TextBlock {
    const html = finalizeHtml(creoleInline(text));
    return new TextBlock(html, font, true);
  }

  /**
   * Block-level Creole from pre-split lines (no unescape).
   * Pipeline: parseCreoleBlocks → renderCreoleToHtml → finalizeHtml.
   * Lines are assumed to be already unescaped (or raw lines that need no unescape).
   */
  static blockFromLines(lines: string[], font: FontSpec): TextBlock {
    const blocks = parseCreoleBlocks(lines);
    const html = finalizeHtml(renderCreoleToHtml(blocks, font.size));
    return new TextBlock(html, font, true);
  }

  // ── Static utilities ──────────────────────────────────────────────────────

  /**
   * Decode PlantUML escape sequences (~n → newline, etc.) without Creole/HTML processing.
   * For DOT labels, separator detection, and other non-HTML contexts.
   */
  static decodeEscapes(raw: string): string {
    return unescapePlantUml(raw);
  }

  // ── Public interface ─────────────────────────────────────────────────────

  /** Final text content — identical to the string used by measure(). */
  get html(): string { return this._html; }

  /** Measured size (lazy, cached, frozen). */
  measure(): TextSize {
    if (!this._size) {
      this._size = Object.freeze(measureText(
        this._measureInput,
        this._font.size,
        this._font.family,
        this._font.weight || 'normal',
        this._font.style || 'normal',
        this._measureAsHtml,
      ));
    }
    return this._size;
  }

  get width(): number { return this.measure().width; }
  get height(): number { return this.measure().height; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Module-internal pipeline
//
// All functions below are private to this module. External code accesses them
// exclusively through TextBlock factory methods. closeUnclosedTags is the sole
// exception — exported for sequence-gen.ts boundary safety.
// ═══════════════════════════════════════════════════════════════════════════════

// ── PlantUML escape sequences ────────────────────────────────────────────────

function unescapePlantUml(text: string): string {
  let s = text;
  s = s.replace(/\\\\/g, '\x00');
  s = s.replace(/\\n/g, '\n');
  s = s.replace(/\\r/g, '\n');
  s = s.replace(/\\l/g, '\n');
  s = s.replace(/\\t/g, '\t');
  s = s.replace(/\x00/g, '\\');
  return s;
}

// ── Creole inline markup ─────────────────────────────────────────────────────

/** Escape text so it renders as literal content in HTML. */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const EMOJI_MAP: Record<string, number> = {
  // Smileys & People
  'grinning': 0x1F600, '1f600': 0x1F600, 'smile': 0x1F604, 'laughing': 0x1F606,
  'innocent': 0x1F607, 'wink': 0x1F609, 'blush': 0x1F60A, 'heart_eyes': 0x1F60D,
  'sunglasses': 0x1F60E, 'thinking': 0x1F914, 'neutral_face': 0x1F610,
  'expressionless': 0x1F611, 'unamused': 0x1F612, 'sweat': 0x1F613,
  'pensive': 0x1F614, 'confused': 0x1F615, 'disappointed': 0x1F61E,
  'worried': 0x1F61F, 'angry': 0x1F620, 'cry': 0x1F622, 'sob': 0x1F62D,
  'scream': 0x1F631, 'sleeping': 0x1F634, 'dizzy_face': 0x1F635,
  'mask': 0x1F637, 'thumbsup': 0x1F44D, 'thumbsdown': 0x1F44E,
  'clap': 0x1F44F, 'wave': 0x1F44B, 'pray': 0x1F64F,
  'muscle': 0x1F4AA, 'raised_hands': 0x1F64C,
  // Hearts & Symbols
  'heart': 0x2764, 'broken_heart': 0x1F494, 'star': 0x2B50, 'sparkles': 0x2728,
  'fire': 0x1F525, 'zap': 0x26A1, 'sunny': 0x2600, 'cloud': 0x2601,
  'umbrella': 0x2602, 'snowflake': 0x2744, 'rainbow': 0x1F308,
  // Objects
  'phone': 0x1F4DE, 'email': 0x1F4E7, 'computer': 0x1F4BB, 'key': 0x1F511,
  'lock': 0x1F512, 'unlock': 0x1F513, 'bell': 0x1F514, 'gear': 0x2699,
  'wrench': 0x1F527, 'hammer': 0x1F528, 'bulb': 0x1F4A1, 'bomb': 0x1F4A3,
  'trophy': 0x1F3C6, 'clock': 0x1F554, 'hourglass': 0x231B,
  // Checkmarks & Arrows
  'check': 0x2714, 'x': 0x274C, 'warning': 0x26A0, 'no_entry': 0x26D4,
  'question': 0x2753, 'exclamation': 0x2757, 'info': 0x2139,
  'arrow_right': 0x27A1, 'arrow_left': 0x2B05, 'arrow_up': 0x2B06, 'arrow_down': 0x2B07,
  // Animals & Nature
  'dog': 0x1F436, 'cat': 0x1F431, 'bug': 0x1F41B, 'ant': 0x1F41C,
  'fish': 0x1F41F, 'turtle': 0x1F422, 'monkey': 0x1F435,
  // Food
  'coffee': 0x2615, 'beer': 0x1F37A, 'cake': 0x1F370, 'pizza': 0x1F355,
  // Transport
  'car': 0x1F697, 'rocket': 0x1F680, 'airplane': 0x2708, 'ship': 0x1F6A2,
};

const OPENICONIC_MAP: Record<string, number> = {
  'heart': 0x2665, 'star': 0x2605, 'check': 0x2714, 'x': 0x2718,
  'plus': 0x002B, 'minus': 0x2212, 'ban': 0x1F6AB,
  'bell': 0x1F514, 'bolt': 0x26A1, 'book': 0x1F4D6, 'bookmark': 0x1F516,
  'box': 0x25A1, 'bug': 0x1F41B, 'calendar': 0x1F4C5, 'chat': 0x1F4AC,
  'clock': 0x1F554, 'cloud': 0x2601, 'cog': 0x2699, 'compass': 0x1F9ED,
  'dashboard': 0x1F4CA, 'delete': 0x2716, 'document': 0x1F4C4,
  'envelope-closed': 0x2709, 'envelope-open': 0x1F4E8, 'eye': 0x1F441,
  'file': 0x1F4C4, 'flag': 0x1F3F3, 'flash': 0x26A1, 'folder': 0x1F4C1,
  'fork': 0x1F374, 'globe': 0x1F310, 'graph': 0x1F4C8, 'grid': 0x25A6,
  'home': 0x1F3E0, 'image': 0x1F5BC, 'inbox': 0x1F4E5,
  'info': 0x2139, 'key': 0x1F511, 'laptop': 0x1F4BB, 'layers': 0x1F5C2,
  'link-intact': 0x1F517, 'list': 0x1F4CB, 'location': 0x1F4CD,
  'lock-locked': 0x1F512, 'lock-unlocked': 0x1F513, 'loop': 0x1F503,
  'magnifying-glass': 0x1F50D, 'map': 0x1F5FA, 'map-marker': 0x1F4CD,
  'menu': 0x2630, 'microphone': 0x1F3A4, 'monitor': 0x1F5A5,
  'moon': 0x1F319, 'musical-note': 0x1F3B5, 'paperclip': 0x1F4CE,
  'pencil': 0x270F, 'people': 0x1F465, 'person': 0x1F464,
  'phone': 0x1F4DE, 'pin': 0x1F4CC, 'play-circle': 0x25B6,
  'power-standby': 0x23FB, 'print': 0x1F5A8, 'project': 0x1F4CB,
  'puzzle-piece': 0x1F9E9, 'question-mark': 0x2753, 'reload': 0x1F503,
  'rss': 0x1F4E1, 'script': 0x1F4DC, 'share': 0x1F517, 'shield': 0x1F6E1,
  'signal': 0x1F4F6, 'spreadsheet': 0x1F4CA, 'sun': 0x2600,
  'tag': 0x1F3F7, 'tags': 0x1F3F7, 'target': 0x1F3AF,
  'task': 0x2611, 'terminal': 0x1F4BB, 'thumb-down': 0x1F44E,
  'thumb-up': 0x1F44D, 'timer': 0x23F1, 'transfer': 0x21C4,
  'trash': 0x1F5D1, 'underline': 0x005F, 'warning': 0x26A0,
  'wifi': 0x1F4F6, 'wrench': 0x1F527, 'zoom-in': 0x1F50D, 'zoom-out': 0x1F50E,
};

function creoleInline(text: string): string {
  let s = text;

  // --- Wave-underline ~~text~~ — must be handled BEFORE tilde escape ---
  const waveEscapes: string[] = [];
  s = s.replace(/~~(.+?)~~/g, (_, inner) => {
    waveEscapes.push(inner);
    return `\x00WAVE${waveEscapes.length - 1}\x00`;
  });

  // --- Phase 1.1: Tilde escape (~) — protect next markup character ---
  const tildeEscapes: string[] = [];
  s = s.replace(/~(.)/g, (_, ch) => {
    tildeEscapes.push(ch);
    return `\x00TESC${tildeEscapes.length - 1}\x00`;
  });

  // --- Phase 1.2: <plain>text</plain> — disable all markup inside ---
  const plainEscapes: string[] = [];
  s = s.replace(/<plain>([\s\S]*?)<\/plain>/gi, (_, inner) => {
    plainEscapes.push(inner);
    return `\x00PLAIN${plainEscapes.length - 1}\x00`;
  });

  // --- PlantUML HTML-like tags → standard HTML ---

  // <color[:/ ]value>text</color> → <font color="value">text</font>
  s = s.replace(/<color[: ]+([^>]+)>([\s\S]*?)<\/color>/gi,
    (_, c, t) => `<font color="${c.trim()}">${t}</font>`);

  // <size[:/ ]N>text</size> → <font style="font-size:Npx">text</font>
  s = s.replace(/<size[: ]+(\d+)>([\s\S]*?)<\/size>/gi,
    (_, n, t) => `<font style="font-size:${n}px">${t}</font>`);

  // <back[:/ ]value>text</back> → <span style="background-color:value">text</span>
  s = s.replace(/<back[: ]+([^>]+)>([\s\S]*?)<\/back>/gi,
    (_, c, t) => `<span style="background-color:${c.trim()}">${t}</span>`);

  // <font:family>text</font> → <font face="family">text</font>
  s = s.replace(/<font:([^>]+)>([\s\S]*?)<\/font>/gi,
    (_, f, t) => `<font face="${f.trim()}">${t}</font>`);

  // <w[:color]>text</w> → <u>text</u>
  s = s.replace(/<w(?::[^>]*)?>(([\s\S]*?))<\/w>/gi, '<u>$1</u>');

  // <u:color> → <u>
  s = s.replace(/<u:[^>]+>/gi, '<u>');

  // <s:color> → <s>
  s = s.replace(/<s:[^>]+>/gi, '<s>');

  // <strike> / </strike> → <s> / </s>
  s = s.replace(/<strike>/gi, '<s>');
  s = s.replace(/<\/strike>/gi, '</s>');

  // <img ...> → (Cannot decode)
  s = s.replace(/<img\s+[^>]*>/gi, '(Cannot decode)');

  // --- Creole inline markup → HTML ---
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\/\/(.+?)\/\//g, '<i>$1</i>');
  s = s.replace(/__(.+?)__/g, '<u>$1</u>');
  s = s.replace(/--(.+?)--/g, '<s>$1</s>');
  s = s.replace(/""(.+?)""/g, '<code>$1</code>');

  // Unescape PlantUML Unicode escape: <U+XXXX> → character
  s = s.replace(/<U\+([0-9A-Fa-f]{4,5})>/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16))
  );

  // Emoji <:name:> → Unicode character
  s = s.replace(/<(?:#[0-9a-fA-F]*:)?([a-z0-9_]+):>/gi, (match, name) => {
    const cp = EMOJI_MAP[name.toLowerCase()];
    return cp ? String.fromCodePoint(cp) : match;
  });

  // OpenIconic <&name> → Unicode approximation
  s = s.replace(/<&([a-z0-9-]+)>/gi, (match, name) => {
    const cp = OPENICONIC_MAP[name.toLowerCase()];
    return cp ? String.fromCodePoint(cp) : match;
  });

  // Inline stereotype: <<Foo>> → «Foo»
  // Keep this in the Creole pipeline so all inline text contexts share
  // the same normalization behavior.
  s = s.replace(/<<\s*([^<>]+?)\s*>>/g, '«$1»');

  // --- Restore escaped sections (reverse order) ---

  for (let i = 0; i < plainEscapes.length; i++) {
    s = s.replace(`\x00PLAIN${i}\x00`, escapeHtmlText(plainEscapes[i]));
  }

  for (let i = 0; i < tildeEscapes.length; i++) {
    s = s.replace(`\x00TESC${i}\x00`, escapeHtmlText(tildeEscapes[i]));
  }

  for (let i = 0; i < waveEscapes.length; i++) {
    s = s.replace(`\x00WAVE${i}\x00`, `<u>${creoleInline(waveEscapes[i])}</u>`);
  }

  // --- Escape stray angle brackets that are NOT known HTML tags ---
  const ALLOWED_TAG = /^<\/?(?:b|i|u|s|strike|del|plain|back|w|font|color|size|sub|sup|code|pre|img|text|math|latex|hr|br|span|div|p|table|tr|td|th)[\s>/]/i;
  const VOID_ALLOWED = /^<(?:br|hr|img)\s*\/?>/i;
  s = s.replace(/<[^>]*>/g, (tag) => {
    if (ALLOWED_TAG.test(tag) || VOID_ALLOWED.test(tag)) return tag;
    if (/^<\/[a-z]+\s*>/i.test(tag) && ALLOWED_TAG.test('<' + tag.slice(2))) return tag;
    return tag.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });

  s = closeUnclosedTags(s);

  return s;
}

/**
 * Close unclosed HTML tags in a string so styles don't leak.
 * E.g. `<b>bold text` → `<b>bold text</b>`
 *
 * Exported for sequence-gen.ts boundary concatenation (prefix + label).
 */
export function closeUnclosedTags(html: string): string {
  const openTags: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const tagName = m[1].toLowerCase();
    if (full.endsWith('/>') || /^(br|hr|img|input)$/i.test(tagName)) continue;
    if (full.startsWith('</')) {
      const idx = openTags.lastIndexOf(tagName);
      if (idx !== -1) openTags.splice(idx, 1);
    } else {
      openTags.push(tagName);
    }
  }
  for (let i = openTags.length - 1; i >= 0; i--) {
    html += `</${openTags[i]}>`;
  }
  return html;
}

// ── Creole block parser ──────────────────────────────────────────────────────

type CreoleBlock =
  | { type: 'text'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4; content: string }
  | { type: 'separator'; lineType: 'solid' | 'double' | 'strong' | 'dotted'; title?: string }
  | { type: 'list'; ordered: boolean; items: CreoleListItem[] }
  | { type: 'table'; rows: CreoleTableRow[] }
  | { type: 'tree'; items: CreoleTreeItem[] }
  | { type: 'code'; content: string };

interface CreoleListItem {
  level: number;
  content: string;
  ordered: boolean;
}

interface CreoleTableRow {
  rowBgColor?: string;
  rowBorderColor?: string;
  cells: CreoleTableCell[];
}

interface CreoleTableCell {
  isHeader: boolean;
  bgColor?: string;
  content: string;
}

interface CreoleTreeItem {
  level: number;
  content: string;
}

const RE_SEP_SOLID   = /^-{4,}$/;
const RE_SEP_DOUBLE  = /^={4,}$/;
const RE_SEP_STRONG  = /^_{4,}$/;
const RE_SEP_DOTTED  = /^\.{4,}$/;
const RE_SEP_TITLED_SOLID  = /^--(.+)--$/;
const RE_SEP_TITLED_DOUBLE = /^==(.+)==$/;
const RE_SEP_TITLED_DOTTED = /^\.\.(.+)\.\.$/;
const RE_HEADING = /^(={1,4})\s*(.+)$/;
const RE_UNORDERED_LIST = /^(\*+)\s+(.*)$/;
const RE_ORDERED_LIST   = /^(#+)\s+(.*)$/;
const RE_TABLE_ROW = /^(?:<#([^>]+)>)?\|(.+)\|$/;
const RE_TREE_ITEM = /^(\s*)\|_\s*(.*)$/;
const RE_CODE_START = /^<code>$/i;
const RE_CODE_END   = /^<\/code>$/i;

function parseCreoleBlocks(lines: string[]): CreoleBlock[] {
  const blocks: CreoleBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // Code block: <code> ... </code>
    if (RE_CODE_START.test(trimmed)) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !RE_CODE_END.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      continue;
    }

    // Separator (plain)
    if (RE_SEP_SOLID.test(trimmed)) { blocks.push({ type: 'separator', lineType: 'solid' }); i++; continue; }
    if (RE_SEP_DOUBLE.test(trimmed)) { blocks.push({ type: 'separator', lineType: 'double' }); i++; continue; }
    if (RE_SEP_STRONG.test(trimmed)) { blocks.push({ type: 'separator', lineType: 'strong' }); i++; continue; }
    if (RE_SEP_DOTTED.test(trimmed)) { blocks.push({ type: 'separator', lineType: 'dotted' }); i++; continue; }

    // Separator with title
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(RE_SEP_TITLED_DOTTED))) {
      blocks.push({ type: 'separator', lineType: 'dotted', title: m[1].trim() }); i++; continue;
    }
    if ((m = trimmed.match(RE_SEP_TITLED_DOUBLE))) {
      blocks.push({ type: 'separator', lineType: 'double', title: m[1].trim() }); i++; continue;
    }
    if ((m = trimmed.match(RE_SEP_TITLED_SOLID))) {
      blocks.push({ type: 'separator', lineType: 'solid', title: m[1].trim() }); i++; continue;
    }

    // Heading
    if ((m = trimmed.match(RE_HEADING))) {
      const level = Math.min(m[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ type: 'heading', level, content: m[2].trim() }); i++; continue;
    }

    // List (unordered or ordered)
    if (RE_UNORDERED_LIST.test(trimmed) || RE_ORDERED_LIST.test(trimmed)) {
      const ordered = trimmed.charAt(0) === '#';
      const items: CreoleListItem[] = [];
      while (i < lines.length) {
        const lt = lines[i].trim();
        const lmOrd = lt.match(RE_ORDERED_LIST);
        const lmUno = lt.match(RE_UNORDERED_LIST);
        if (!lmOrd && !lmUno) break;
        if (lmOrd) {
          items.push({ level: lmOrd[1].length, content: lmOrd[2].trim(), ordered: true });
        } else {
          items.push({ level: lmUno![1].length, content: lmUno![2].trim(), ordered: false });
        }
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Table
    if (RE_TABLE_ROW.test(trimmed)) {
      const rows: CreoleTableRow[] = [];
      while (i < lines.length) {
        const rt = lines[i].trim();
        const rm = rt.match(RE_TABLE_ROW);
        if (!rm) break;
        const row: CreoleTableRow = { cells: [] };
        if (rm[1]) {
          const parts = rm[1].split(',');
          row.rowBgColor = parts[0].trim();
          if (parts[1]) row.rowBorderColor = parts[1].trim();
        }
        const cellStr = rm[2];
        const cells = splitTableCells(cellStr);
        for (const raw of cells) {
          const cell = parseTableCell(raw);
          row.cells.push(cell);
        }
        rows.push(row);
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }

    // Tree structure: |_ item
    if (RE_TREE_ITEM.test(line)) {
      const items: CreoleTreeItem[] = [];
      while (i < lines.length) {
        const tm = lines[i].match(RE_TREE_ITEM);
        if (!tm) break;
        const indent = tm[1].length;
        const level = Math.floor(indent / 2);
        items.push({ level, content: tm[2].trim() });
        i++;
      }
      blocks.push({ type: 'tree', items });
      continue;
    }

    // Regular text line
    blocks.push({ type: 'text', content: trimmed });
    i++;
  }

  return blocks;
}

function splitTableCells(inner: string): string[] {
  const cells: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) cells.push(current);
  return cells;
}

function parseTableCell(raw: string): CreoleTableCell {
  let s = raw.trim();
  let isHeader = false;
  let bgColor: string | undefined;
  if (s.startsWith('=')) { isHeader = true; s = s.slice(1).trim(); }
  const colorMatch = s.match(/^<#([^>]+)>\s*(.*)/);
  if (colorMatch) { bgColor = colorMatch[1].trim(); s = colorMatch[2]; }
  return { isHeader, bgColor, content: s.trim() };
}

// ── Creole block renderer → HTML ─────────────────────────────────────────────

const HEADING_OFFSETS: Record<number, number> = { 1: 4, 2: 2, 3: 1, 4: 0 };

function renderCreoleToHtml(blocks: CreoleBlock[], baseFontSize: number = 12): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(creoleInline(block.content));
        break;
      case 'heading': {
        const size = baseFontSize + (HEADING_OFFSETS[block.level] || 0);
        parts.push(`<div style="font-size:${size}px;font-weight:bold">${creoleInline(block.content)}</div>`);
        break;
      }
      case 'separator':
        parts.push(renderSeparator(block.lineType, block.title));
        break;
      case 'list':
        parts.push(renderList(block.ordered, block.items));
        break;
      case 'table':
        parts.push(renderTable(block.rows));
        break;
      case 'tree':
        parts.push(renderTree(block.items));
        break;
      case 'code':
        parts.push(`<pre style="margin:0"><code>${escapeHtmlText(block.content)}</code></pre>`);
        break;
    }
  }
  return parts.join('\n');
}

function renderSeparator(lineType: string, title?: string): string {
  const styles: Record<string, string> = {
    solid:  'border:none;border-top:1px solid #888',
    double: 'border:none;border-top:3px double #888',
    strong: 'border:none;border-top:2px solid #888',
    dotted: 'border:none;border-top:1px dashed #888',
  };
  const style = styles[lineType] || styles.solid;
  if (title) {
    return `<div style="text-align:center;position:relative"><hr style="${style}"/><span style="position:relative;top:-0.7em;background:white;padding:0 4px">${creoleInline(title)}</span></div>`;
  }
  return `<hr style="${style}"/>`;
}

function renderList(_ordered: boolean, items: CreoleListItem[]): string {
  const lines: string[] = [];
  const counters: number[] = [];
  let lastOrderedLevel = 0;
  for (const item of items) {
    const isOrdered = item.ordered;
    let displayLevel: number;
    if (isOrdered) {
      displayLevel = item.level;
      lastOrderedLevel = item.level;
      while (counters.length < displayLevel) counters.push(0);
      if (counters.length > displayLevel) counters.length = displayLevel;
      counters[displayLevel - 1] = (counters[displayLevel - 1] || 0) + 1;
      const indent = displayLevel > 1 ? '&nbsp;&nbsp;'.repeat(displayLevel - 1) : '';
      lines.push(`${indent}${counters[displayLevel - 1]}. ${creoleInline(item.content)}`);
    } else {
      displayLevel = lastOrderedLevel + item.level;
      const indent = displayLevel > 1 ? '&nbsp;&nbsp;'.repeat(displayLevel - 1) : '';
      const marker = lastOrderedLevel > 0
        ? '*'
        : (item.level <= 1 ? '&#x2022;' : '&#x25AA;');
      lines.push(`${indent}${marker} ${creoleInline(item.content)}`);
    }
  }
  return lines.join('<br/>');
}

function renderTable(rows: CreoleTableRow[]): string {
  const parts: string[] = [];
  parts.push('<table style="border-collapse:collapse">');
  for (const row of rows) {
    let rowStyle = '';
    if (row.rowBgColor) rowStyle += `background-color:${row.rowBgColor};`;
    if (row.rowBorderColor) rowStyle += `border:1px solid ${row.rowBorderColor};`;
    parts.push(rowStyle ? `<tr style="${rowStyle}">` : '<tr>');
    for (const cell of row.cells) {
      const tag = cell.isHeader ? 'th' : 'td';
      let cellStyle = 'border:1px solid #ccc;padding:2px 6px;';
      if (cell.isHeader) cellStyle += 'font-weight:bold;background-color:#f0f0f0;';
      if (cell.bgColor) cellStyle += `background-color:${cell.bgColor};`;
      parts.push(`<${tag} style="${cellStyle}">${creoleInline(cell.content)}</${tag}>`);
    }
    parts.push('</tr>');
  }
  parts.push('</table>');
  return parts.join('');
}

function renderTree(items: CreoleTreeItem[]): string {
  const parts: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isLast = i === items.length - 1 || (i + 1 < items.length && items[i + 1].level <= item.level);
    const prefix = item.level === 0
      ? ''
      : '  '.repeat(item.level - 1) + (isLast ? '└── ' : '├── ');
    parts.push(`${prefix}${creoleInline(item.content)}`);
  }
  return `<pre style="font-family:monospace;margin:0">${parts.join('\n')}</pre>`;
}

// ── HTML finalization ────────────────────────────────────────────────────────

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
