/**
 * Packetdiag layout — pure bit-grid arithmetic, no graph engine needed.
 *
 * Converts bit-offset declarations into pixel coordinates:
 *   x = bitOffset × colwidth
 *   y = rowIndex × nodeHeight + SCALE_HEADER
 * Auto-wraps fields to the next row when a row exceeds maxBitsPerRow.
 */
import type { PacketdiagModel, PacketdiagField, PacketdiagLayoutField, PacketdiagLayoutResult } from '../model/packetdiag-model.ts';
import type { Renderer } from '../primitives/renderer.ts';
import { createRenderer } from '../primitives/registry.ts';
import type { Theme } from '../shared/theme.ts';
import { createTheme } from '../shared/theme.ts';
import { TextBlock } from '../shared/text-block.ts';

// ── Theme-derived geometry (kept in sync with packetdiag-gen.ts) ────────────

function scaleHeaderH(t: Theme): number { return t.sizeL; }
function bitPx(t: Theme): number { return t.sizeL; }
function defaultNodeH(t: Theme): number { return t.sizeL; }

/** Compute row width: config.colwidth = bits per row. Default auto-detect. */
function getRowWidth(config: { colwidth?: number }, fields: PacketdiagField[]): number {
  if (config.colwidth) return config.colwidth;
  // Auto: 32 if any field > 16, else 16
  let maxW = 0;
  for (const f of fields) {
    const w = f.length ?? ((f.bitEnd ?? 0) - (f.bitStart ?? 0) + 1);
    if (w > maxW) maxW = w;
  }
  return maxW > 16 ? 32 : 16;
}

export interface PacketdiagLayoutOptions {
  theme?: Theme;
}

/**
 * Main entry: compute pixel positions for all fields and create renderers.
 */
export function packetdiagLayout(
  model: PacketdiagModel,
  options?: PacketdiagLayoutOptions,
): { renderers: Map<string, Renderer>; layout: PacketdiagLayoutResult } {
  const theme = options?.theme ?? createTheme();
  const nodeHeight = model.config.nodeHeight ?? defaultNodeH(theme);
  const scaleDir = model.config.scaleDirection ?? 'ltr';
  const maxBitsPerRow = getRowWidth(model.config, model.fields);
  const pixPerBit = bitPx(theme);
  const scaleH = scaleHeaderH(theme);

  // 1. Row assignment via auto-wrap
  const rows = assignRows(model.fields, maxBitsPerRow);

  // rtl: reverse field order within each row (highest bit = leftmost)
  if (scaleDir === 'rtl') {
    for (const row of rows) row.reverse();
  }

  // 2. Compute pixel coordinates for each field
  // same_height: all fields get the max height in their row
  const sameHeight = model.config.sameHeight === true;

  const layoutFields: PacketdiagLayoutField[] = [];
  let actualMaxBits = 0; // actual data extent (PlantUML: only render used bits)
  for (let ri = 0; ri < rows.length; ri++) {
    let rowBitCursor = 0;
    // Compute max height in this row for same_height
    let maxH = 0;
    if (sameHeight) {
      for (const field of rows[ri]) {
        const h = nodeHeight * (field.height ?? 1);
        if (h > maxH) maxH = h;
      }
    }
    for (const field of rows[ri]) {
      const len = field.length ?? ((field.bitEnd ?? 0) - (field.bitStart ?? 0) + 1);
      // rtl: rows already reversed, so use simple left-to-right pixel placement
      const x = rowBitCursor * pixPerBit;
      const y = ri * nodeHeight + scaleH;
      const h = sameHeight ? maxH : nodeHeight * (field.height ?? 1);
      const rawLabel = field.description || field.label;
      const displayLabel = TextBlock.inline(rawLabel, { size: theme.fontSize, family: theme.fontFamily }).html;

      layoutFields.push({
        id: field.id,
        label: field.label,
        displayLabel,
        row: ri,
        bitOffset: rowBitCursor,
        bitStart: field.bitStart,
        bitEnd: field.bitEnd,
        length: len,
        x,
        y,
        w: len * pixPerBit,
        h,
        rotate: field.rotate,
        height: field.height,
        color: field.color,
        textColor: field.textColor,
        border: field.border,
        lineColor: field.lineColor,
        isReserved: field.isReserved,
      });

      rowBitCursor += len;
    }
    if (rowBitCursor > actualMaxBits) actualMaxBits = rowBitCursor;
  }

  // 3. Create renderers
  const renderers = new Map<string, Renderer>();
  for (const lf of layoutFields) {
    const renderer = createRenderer('packetdiag-field', {
      id: lf.id,
      label: lf.displayLabel || lf.label,
      color: lf.color,
      textColor: lf.textColor,
      lineColor: lf.lineColor,
      rotate: lf.rotate,
      isReserved: lf.isReserved,
      border: lf.border,
      theme,
    } as any);
    renderers.set(lf.id, renderer);
  }

  return {
    renderers,
    layout: {
      fields: layoutFields,
      rowCount: rows.length,
      totalWidth: actualMaxBits * pixPerBit,
      totalHeight: rows.length * nodeHeight + scaleH,
      colwidth: pixPerBit,
      nodeHeight,
      maxBitsPerRow,
      scaleDirection: scaleDir,
    },
  };
}

// ── Row assignment ──────────────────────────────────────────────────────────

/** Assign fields to rows using a simple auto-wrap algorithm. */
function assignRows(
  fields: PacketdiagField[],
  maxBitsPerRow: number,
): PacketdiagField[][] {
  const rows: PacketdiagField[][] = [];
  let currentRow: PacketdiagField[] = [];
  let bitCursor = 0;

  for (const field of fields) {
    const len = field.length ?? ((field.bitEnd ?? 0) - (field.bitStart ?? 0) + 1);
    if (len <= 0) continue;

    if (bitCursor + len > maxBitsPerRow && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [];
      bitCursor = 0;
    }
    currentRow.push(field);
    bitCursor += len;
  }

  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

