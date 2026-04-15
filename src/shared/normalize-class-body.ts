import type { BodyLine } from '../model/class-model.ts';
import type { NormalizedBodyBlock } from '../model/normalized-rich-text.ts';
import { TextBlock, type FontSpec, DEFAULT_FONT } from './text-block.ts';

const RE_CB_SEP_SOLID = /^-{2,}$/;
const RE_CB_SEP_DOUBLE = /^={2,}$/;
const RE_CB_SEP_STRONG = /^_{2,}$/;
const RE_CB_SEP_DOTTED = /^\.{2,}$/;
const RE_CB_SEP_TITLED_SOLID = /^--(.+)--$/;
const RE_CB_SEP_TITLED_DOUBLE = /^==(.+)==$/;
const RE_CB_SEP_TITLED_STRONG = /^__(.+)__$/;
const RE_CB_SEP_TITLED_DOTTED = /^\.\.(.+)\.\.$/;
const RE_CB_TABLE_ROW = /^(?:<#[^>]+>)?\|.+\|$/;
const RE_CB_TREE_ITEM = /^\s*\|_\s/;

const RE_VIS_PRIVATE = /^-([^-].*|$)/;
const RE_VIS_PROTECTED = /^#([^#].*|$)/;
const RE_VIS_PACKAGE = /^~([^~].*|$)/;
const RE_VIS_PUBLIC = /^\+([^+].*|$)/;
const RE_VIS_DOT = /^\*([^*].*|$)/;

function bodyLineText(line: BodyLine): string {
  return typeof line === 'string' ? line : line.text;
}

function bodyLineTag(line: BodyLine): string | undefined {
  return typeof line === 'string' ? undefined : line.tag;
}

function iconSlot(inner: string): string {
  return `<span style="display:inline-block;width:0.85em;text-align:center;">${inner}</span>`;
}

const VIS_PRIVATE_FIELD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;box-sizing:border-box;' +
  'border:1px solid #C82930;vertical-align:-0.41em;">' +
  '\u200b</span>';
const VIS_PRIVATE_METHOD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;box-sizing:border-box;' +
  'background:#C82930;border:1px solid #C82930;vertical-align:-0.41em;">' +
  '\u200b</span>';
const VIS_PROTECTED_FIELD =
  '<span style="display:inline-block;width:0.35em;height:0.35em;' +
  'border:1px solid #B38D22;transform:rotate(45deg);vertical-align:-0.49em;">' +
  '\u200b</span>';
const VIS_PROTECTED_METHOD =
  '<span style="display:inline-block;width:0.35em;height:0.35em;' +
  'background:#B38D22;border:1px solid #B38D22;transform:rotate(45deg);vertical-align:-0.49em;">' +
  '\u200b</span>';
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
const VIS_PUBLIC_FIELD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;box-sizing:border-box;' +
  'border:1px solid #038048;vertical-align:-0.41em;">' +
  '\u200b</span>';
const VIS_PUBLIC_METHOD =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;box-sizing:border-box;' +
  'background:#84BE84;border:1px solid #038048;vertical-align:-0.41em;">' +
  '\u200b</span>';
const VIS_DOT_ICON =
  '<span style="display:inline-block;width:0.5em;height:0.5em;border-radius:50%;' +
  'background:#000000;vertical-align:-0.41em;">' +
  '\u200b</span>';

function isMethodLine(body: string, tag?: string): boolean {
  if (tag === 'method') return true;
  if (tag === 'field') return false;
  return body.includes('(') || body.includes(')');
}

const VIS_RULES: Array<{ re: RegExp; fieldIcon: string; methodIcon: string; extraSpace?: boolean }> = [
  { re: RE_VIS_PRIVATE, fieldIcon: VIS_PRIVATE_FIELD, methodIcon: VIS_PRIVATE_METHOD, extraSpace: true },
  { re: RE_VIS_PROTECTED, fieldIcon: VIS_PROTECTED_FIELD, methodIcon: VIS_PROTECTED_METHOD, extraSpace: true },
  { re: RE_VIS_PACKAGE, fieldIcon: VIS_PACKAGE_FIELD, methodIcon: VIS_PACKAGE_METHOD, extraSpace: true },
  { re: RE_VIS_PUBLIC, fieldIcon: VIS_PUBLIC_FIELD, methodIcon: VIS_PUBLIC_METHOD, extraSpace: true },
  { re: RE_VIS_DOT, fieldIcon: VIS_DOT_ICON, methodIcon: VIS_DOT_ICON, extraSpace: true },
];

function applyMemberModifierStyle(html: string, tag?: string): string {
  if (tag === 'static') return `<u>${html}</u>`;
  if (tag === 'abstract') return `<i>${html}</i>`;
  return html;
}

function processBodyLine(raw: string, withIconSlot: boolean, showIcons: boolean, font: FontSpec, tag?: string): string {
  if (showIcons) {
    for (const rule of VIS_RULES) {
      const m = raw.match(rule.re);
      if (!m) continue;
      const space = rule.extraSpace ? ' ' : '';
      const body = (m[1] || '').replace(/^\s+/, '');
      const icon = isMethodLine(body, tag) ? rule.methodIcon : rule.fieldIcon;
      const bodyHtml = applyMemberModifierStyle(TextBlock.inline(body, font).html, tag);
      return iconSlot(icon) + space + bodyHtml;
    }
  } else {
    for (const rule of VIS_RULES) {
      const m = raw.match(rule.re);
      if (!m) continue;
      const visChar = raw[0];
      const body = (m[1] || '').replace(/^\s+/, '');
      const bodyHtml = applyMemberModifierStyle(TextBlock.inline(body, font).html, tag);
      const html = visChar + bodyHtml;
      return withIconSlot ? iconSlot('\u200b') + ' ' + html : html;
    }
  }

  const html = applyMemberModifierStyle(TextBlock.inline(raw, font).html, tag);
  return withIconSlot ? iconSlot('\u200b') + ' ' + html : html;
}

function classifySeparator(line: string): { variant: string; title?: string } | null {
  if (RE_CB_SEP_SOLID.test(line)) return { variant: 'solid' };
  if (RE_CB_SEP_DOUBLE.test(line)) return { variant: 'double' };
  if (RE_CB_SEP_STRONG.test(line)) return { variant: 'strong' };
  if (RE_CB_SEP_DOTTED.test(line)) return { variant: 'dotted' };
  let match: RegExpMatchArray | null;
  if ((match = line.match(RE_CB_SEP_TITLED_SOLID))) return { variant: 'solid', title: match[1].trim() };
  if ((match = line.match(RE_CB_SEP_TITLED_DOUBLE))) return { variant: 'double', title: match[1].trim() };
  if ((match = line.match(RE_CB_SEP_TITLED_STRONG))) return { variant: 'strong', title: match[1].trim() };
  if ((match = line.match(RE_CB_SEP_TITLED_DOTTED))) return { variant: 'dotted', title: match[1].trim() };
  return null;
}

function deriveRowId(nodeId: string, line: string): string | undefined {
  const stripped = line.replace(/^[+\-#~*]\s*/, '').trim();
  const arrowIdx = stripped.indexOf('=>');
  if (arrowIdx >= 0) {
    const key = stripped.slice(0, arrowIdx).trim();
    return key ? `${nodeId}::${key}` : undefined;
  }
  const colonIdx = stripped.indexOf(':');
  const fieldName = colonIdx >= 0 ? stripped.slice(0, colonIdx).trim() : stripped;
  return fieldName ? `${nodeId}::${fieldName}` : undefined;
}

export function normalizeClassBodyBlocks(opts: {
  nodeId: string;
  bodyLines?: BodyLine[];
  visibilityIcons?: boolean;
  hideFields?: boolean;
  hideMethods?: boolean;
  autoSeparator?: boolean;
  font?: FontSpec;
}): NormalizedBodyBlock[] | undefined {
  const allLines = opts.bodyLines || [];
  if (allLines.length === 0) return undefined;

  const font = opts.font || DEFAULT_FONT;
  const showIcons = opts.visibilityIcons !== false;
  const hideFields = opts.hideFields === true;
  const hideMethods = opts.hideMethods === true;
  const autoSeparator = opts.autoSeparator !== false;

  const lines = (hideFields || hideMethods)
    ? allLines.filter((line) => {
        const text = bodyLineText(line).trim();
        if (classifySeparator(text)) return true;
        const tag = bodyLineTag(line);
        const method = isMethodLine(text, tag);
        if (method && hideMethods) return false;
        if (!method && hideFields) return false;
        return true;
      })
    : allLines;

  const hasVisIcons = showIcons && lines.some((line) => {
    const text = bodyLineText(line).trim();
    return VIS_RULES.some((rule) => rule.re.test(text));
  });

  const blocks: NormalizedBodyBlock[] = [];
  const seenRowIds = new Set<string>();
  let hasSeparator = false;
  let index = 0;

  while (index < lines.length) {
    const raw = lines[index];
    const line = bodyLineText(raw).trim();
    const tag = bodyLineTag(raw);

    const sep = classifySeparator(line);
    if (sep) {
      blocks.push({
        kind: 'separator',
        variant: sep.variant,
        titleHtml: sep.title ? processBodyLine(sep.title, false, showIcons, font) : undefined,
      });
      hasSeparator = true;
      index += 1;
      continue;
    }

    if (RE_CB_TABLE_ROW.test(line)) {
      const tableLines: string[] = [];
      while (index < lines.length && RE_CB_TABLE_ROW.test(bodyLineText(lines[index]).trim())) {
        tableLines.push(bodyLineText(lines[index]).trim());
        index += 1;
      }
      blocks.push({ kind: 'rich', html: TextBlock.blockFromLines(tableLines, font).html });
      continue;
    }

    if (RE_CB_TREE_ITEM.test(line)) {
      const treeLines: string[] = [];
      while (index < lines.length && RE_CB_TREE_ITEM.test(bodyLineText(lines[index]).trim())) {
        treeLines.push(bodyLineText(lines[index]).trim());
        index += 1;
      }
      blocks.push({ kind: 'rich', html: TextBlock.blockFromLines(treeLines, font).html });
      continue;
    }

    let rowId = deriveRowId(opts.nodeId, line);
    if (rowId && seenRowIds.has(rowId)) {
      let suffix = 2;
      while (seenRowIds.has(`${rowId}_${suffix}`)) suffix += 1;
      rowId = `${rowId}_${suffix}`;
    }
    if (rowId) seenRowIds.add(rowId);
    blocks.push({ kind: 'row', html: processBodyLine(line, hasVisIcons, showIcons, font, tag), id: rowId });
    index += 1;
  }

  if (!hasSeparator && autoSeparator) {
    const rowIndices: number[] = [];
    for (let i = 0; i < blocks.length; i += 1) {
      if (blocks[i].kind === 'row') rowIndices.push(i);
    }

    let splitIdx = -1;
    let hasFieldRow = false;
    if (rowIndices.length > 0 && lines.length > 0) {
      let lineIdx = 0;
      for (const rowIndex of rowIndices) {
        while (lineIdx < lines.length) {
          const text = bodyLineText(lines[lineIdx]).trim();
          if (classifySeparator(text) || RE_CB_TABLE_ROW.test(text) || RE_CB_TREE_ITEM.test(text)) {
            lineIdx += 1;
            continue;
          }
          break;
        }
        if (lineIdx < lines.length) {
          const current = lines[lineIdx];
          const currentText = bodyLineText(current).trim();
          const currentTag = bodyLineTag(current);
          if (isMethodLine(currentText, currentTag)) {
            if (hasFieldRow) splitIdx = rowIndex;
            break;
          }
          hasFieldRow = true;
        }
        lineIdx += 1;
      }
    }

    if (splitIdx > 0) {
      blocks.splice(splitIdx, 0, { kind: 'separator', variant: 'default' });
    } else if (!hideFields && !hideMethods) {
      if (!hasFieldRow && rowIndices.length > 0) {
        blocks.splice(rowIndices[0], 0, { kind: 'separator', variant: 'default' });
      } else {
        blocks.push({ kind: 'separator', variant: 'default' });
      }
    }
  }

  return blocks;
}