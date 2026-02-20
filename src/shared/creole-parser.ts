/**
 * Creole block-level parser.
 *
 * Parses multi-line Creole text into a sequence of typed blocks.
 * Each block represents a structural element (heading, list, table, separator, etc.).
 * Inline markup within block content is NOT processed here — that is the
 * responsibility of `creoleInline()` at render time.
 *
 * Usage:
 *   const blocks = parseCreoleBlocks(lines);
 *   const html = renderCreoleToHtml(blocks);  // see creole-render.ts
 */

// ─── Data Model (matches §6.3 in CREOLE-UPGRADE.md) ─────────────────────────

export type CreoleBlock =
  | { type: 'text'; content: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4; content: string }
  | { type: 'separator'; lineType: 'solid' | 'double' | 'strong' | 'dotted'; title?: string }
  | { type: 'list'; ordered: boolean; items: CreoleListItem[] }
  | { type: 'table'; rows: CreoleTableRow[] }
  | { type: 'tree'; items: CreoleTreeItem[] }
  | { type: 'code'; content: string };

export interface CreoleListItem {
  level: number;    // 1 = *, 2 = **, 3 = ***
  content: string;  // raw inline creole text
  ordered: boolean; // true = # (numbered), false = * (bullet)
}

export interface CreoleTableRow {
  rowBgColor?: string;
  rowBorderColor?: string;
  cells: CreoleTableCell[];
}

export interface CreoleTableCell {
  isHeader: boolean;    // |= header |
  bgColor?: string;     // |<#color> cell |
  content: string;      // raw inline creole text
}

export interface CreoleTreeItem {
  level: number;    // indentation depth (0-based)
  content: string;  // raw inline creole text
}

// ─── Regex patterns ──────────────────────────────────────────────────────────

// Separator: ---- (solid), ==== (double), ____ (strong), .... (dotted)
// With optional title: --Title--, ==Title==, ..Title..
const RE_SEP_SOLID   = /^-{4,}$/;
const RE_SEP_DOUBLE  = /^={4,}$/;
const RE_SEP_STRONG  = /^_{4,}$/;
const RE_SEP_DOTTED  = /^\.{4,}$/;
const RE_SEP_TITLED_SOLID  = /^--(.+)--$/;
const RE_SEP_TITLED_DOUBLE = /^==(.+)==$/;
const RE_SEP_TITLED_DOTTED = /^\.\.(.+)\.\.$/;

// Heading: = / == / === / ==== at start of line
const RE_HEADING = /^(={1,4})\s+(.+)$/;

// List item: * / ** / *** or # / ## / ###
const RE_UNORDERED_LIST = /^(\*+)\s+(.*)$/;
const RE_ORDERED_LIST   = /^(#+)\s+(.*)$/;

// Table row: | cell | cell | (optionally prefixed with <#color> or <#bg,#border>)
const RE_TABLE_ROW = /^(?:<#([^>]+)>)?\|(.+)\|$/;

// Tree item: |_ content (with optional leading spaces for nesting)
const RE_TREE_ITEM = /^(\s*)\|_\s*(.*)$/;

// Code block markers
const RE_CODE_START = /^<code>$/i;
const RE_CODE_END   = /^<\/code>$/i;

// ─── Parser ──────────────────────────────────────────────────────────────────

export function parseCreoleBlocks(lines: string[]): CreoleBlock[] {
  const blocks: CreoleBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      i++;
      continue;
    }

    // --- Code block: <code> ... </code> ---
    if (RE_CODE_START.test(trimmed)) {
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !RE_CODE_END.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip </code>
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      continue;
    }

    // --- Separator (plain, no title) ---
    if (RE_SEP_SOLID.test(trimmed)) {
      blocks.push({ type: 'separator', lineType: 'solid' });
      i++;
      continue;
    }
    if (RE_SEP_DOUBLE.test(trimmed)) {
      blocks.push({ type: 'separator', lineType: 'double' });
      i++;
      continue;
    }
    if (RE_SEP_STRONG.test(trimmed)) {
      blocks.push({ type: 'separator', lineType: 'strong' });
      i++;
      continue;
    }
    if (RE_SEP_DOTTED.test(trimmed)) {
      blocks.push({ type: 'separator', lineType: 'dotted' });
      i++;
      continue;
    }

    // --- Separator with title ---
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(RE_SEP_TITLED_DOTTED))) {
      blocks.push({ type: 'separator', lineType: 'dotted', title: m[1].trim() });
      i++;
      continue;
    }
    // Titled solid/double must be checked after plain separators.
    // ==Title== has at least one non-= char inside — RE_SEP_DOUBLE already caught pure ====.
    if ((m = trimmed.match(RE_SEP_TITLED_DOUBLE))) {
      blocks.push({ type: 'separator', lineType: 'double', title: m[1].trim() });
      i++;
      continue;
    }
    if ((m = trimmed.match(RE_SEP_TITLED_SOLID))) {
      blocks.push({ type: 'separator', lineType: 'solid', title: m[1].trim() });
      i++;
      continue;
    }

    // --- Heading: = / == / === / ==== ---
    if ((m = trimmed.match(RE_HEADING))) {
      const level = Math.min(m[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ type: 'heading', level, content: m[2].trim() });
      i++;
      continue;
    }

    // --- List (unordered or ordered) — collect consecutive list lines ---
    // Collects ALL consecutive * and # lines into a single block so that
    // mixed lists (e.g. # then * then #) share counters and indentation.
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

    // --- Table — collect consecutive table rows ---
    if (RE_TABLE_ROW.test(trimmed)) {
      const rows: CreoleTableRow[] = [];
      while (i < lines.length) {
        const rt = lines[i].trim();
        const rm = rt.match(RE_TABLE_ROW);
        if (!rm) break;

        const row: CreoleTableRow = { cells: [] };

        // Row-level color prefix: <#bg> or <#bg,#border>
        if (rm[1]) {
          const parts = rm[1].split(',');
          row.rowBgColor = parts[0].trim();
          if (parts[1]) row.rowBorderColor = parts[1].trim();
        }

        // Parse cells from the inner content (between outer pipes)
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

    // --- Tree structure: |_ item ---
    if (RE_TREE_ITEM.test(line)) {
      const items: CreoleTreeItem[] = [];
      while (i < lines.length) {
        const tm = lines[i].match(RE_TREE_ITEM);
        if (!tm) break;
        // Level determined by leading whitespace (each 2 spaces = 1 level)
        const indent = tm[1].length;
        const level = Math.floor(indent / 2);
        items.push({ level, content: tm[2].trim() });
        i++;
      }
      blocks.push({ type: 'tree', items });
      continue;
    }

    // --- Regular text line (inline Creole will be applied) ---
    blocks.push({ type: 'text', content: trimmed });
    i++;
  }

  return blocks;
}

// ─── Table cell helpers ──────────────────────────────────────────────────────

/**
 * Split a table row's inner content into individual cell strings.
 * Input: " cell1 | cell2 |= header " (content between outer pipes)
 * Handles escaped pipes and nested markup.
 */
function splitTableCells(inner: string): string[] {
  const cells: string[] = [];
  let current = '';
  let depth = 0; // Track nested < > so we don't split on | inside tags

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
  // Last segment (after final |) — only add if non-empty
  if (current.trim()) {
    cells.push(current);
  }

  return cells;
}

/**
 * Parse a single table cell string into a CreoleTableCell.
 * Handles header marker (=) and cell background color (<#color>).
 */
function parseTableCell(raw: string): CreoleTableCell {
  let s = raw.trim();
  let isHeader = false;
  let bgColor: string | undefined;

  // Header marker: "= content"
  if (s.startsWith('=')) {
    isHeader = true;
    s = s.slice(1).trim();
  }

  // Cell background color: "<#color> content"
  const colorMatch = s.match(/^<#([^>]+)>\s*(.*)/);
  if (colorMatch) {
    bgColor = colorMatch[1].trim();
    s = colorMatch[2];
  }

  return { isHeader, bgColor, content: s.trim() };
}
