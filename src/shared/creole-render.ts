/**
 * Creole block-level HTML renderer.
 *
 * Converts a list of CreoleBlocks (from `parseCreoleBlocks`) into an HTML string
 * suitable for embedding in DrawIO labels (after `toDrawioHtml` normalization).
 *
 * Each block is rendered to HTML, with inline Creole markup processed via `creoleInline()`.
 */
import type { CreoleBlock, CreoleListItem, CreoleTableRow, CreoleTreeItem } from './creole-parser.ts';
import { creoleInline } from './creole-inline.ts';

// Heading level → offset from base font size (matching PlantUML: base 14 + offset → 18,16,15,14)
const HEADING_OFFSETS: Record<number, number> = {
  1: 4,
  2: 2,
  3: 1,
  4: 0,
};

/**
 * Render an array of CreoleBlocks to HTML string.
 * The output is semantic HTML — callers should pass it through `toDrawioHtml()`
 * for DrawIO-specific normalization.
 *
 * @param baseFontSize — base font size for computing heading sizes (default 14)
 */
export function renderCreoleToHtml(blocks: CreoleBlock[], baseFontSize: number = 14): string {
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
        // Code blocks render as monospace, with all markup disabled
        // margin:0 resets browser-default <pre> margins to prevent overflow
        parts.push(`<pre style="margin:0"><code>${escapeHtml(block.content)}</code></pre>`);
        break;
    }
  }

  return parts.join('\n');
}

// ─── Block renderers ─────────────────────────────────────────────────────────

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
  // Render as flat text lines with bullet/number markers and &nbsp; indentation.
  // Avoids <ul>/<ol> elements whose browser-default padding causes measurement
  // vs rendering mismatch in foreignObject-based SVG.
  //
  // Mixed lists: when * items appear inside a # list, they are indented one
  // level deeper than the last ordered item.  Ordered counters persist across
  // the interruption so that e.g. # → ## → * → # gives 1, 2, (sub) , *, 3.
  const lines: string[] = [];
  const counters: number[] = []; // per-level ordered counters
  let lastOrderedLevel = 0;     // track nesting depth of preceding # items

  for (const item of items) {
    const isOrdered = item.ordered;
    let displayLevel: number;

    if (isOrdered) {
      displayLevel = item.level;
      lastOrderedLevel = item.level;

      // Maintain per-level counters
      while (counters.length < displayLevel) counters.push(0);
      // Reset deeper counters when returning to a shallower level
      if (counters.length > displayLevel) counters.length = displayLevel;
      counters[displayLevel - 1] = (counters[displayLevel - 1] || 0) + 1;

      const indent = displayLevel > 1 ? '&nbsp;&nbsp;'.repeat(displayLevel - 1) : '';
      lines.push(`${indent}${counters[displayLevel - 1]}. ${creoleInline(item.content)}`);
    } else {
      // Unordered item — indent one level deeper than the last ordered context
      displayLevel = lastOrderedLevel + item.level;
      const indent = displayLevel > 1 ? '&nbsp;&nbsp;'.repeat(displayLevel - 1) : '';
      // Use literal * when mixed into an ordered list (matching PlantUML),
      // otherwise use bullet characters (● for level 1, ▪ for deeper).
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
  // Wrap in monospace pre block for alignment
  return `<pre style="font-family:monospace;margin:0">${parts.join('\n')}</pre>`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
