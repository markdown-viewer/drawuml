/**
 * Packetdiag semantic parser — Phase 2.
 * PEG statements → PacketdiagModel.
 */
import type { PacketdiagModel, PacketdiagField } from '../model/packetdiag-model.ts';

export function parsePacketdiagStatements(
  statements: any[],
  _pragmas?: Record<string, string>,
): PacketdiagModel {
  const ctx: ParseContext = {
    model: { fields: [], config: {} },
    bitCursor: 0,
    fieldIndex: 0,
  };

  for (const st of statements) {
    if (!st) continue;
    switch (st.type) {
      case 'packetdiag_field_range':
        t_fieldRange(ctx, st);
        break;
      case 'packetdiag_field_list':
        t_fieldList(ctx, st);
        break;
      case 'packetdiag_config':
        t_config(ctx, st);
        break;
      // Skip transparent block wrappers and whitespace
      case 'comment_line':
      case 'blank_line':
        break;
      // Style blocks — parsed but not yet applied to fields
      case 'style_block_start':
      case 'style_text_line':
      case 'style_block_end':
        break;
      default:
        break;
    }
  }

  return ctx.model;
}

// ── Context ─────────────────────────────────────────────────────────────────

interface ParseContext {
  model: PacketdiagModel;
  bitCursor: number;    // auto-increment for list form
  fieldIndex: number;
}

// ── Statement handlers ──────────────────────────────────────────────────────

function t_fieldRange(ctx: ParseContext, st: any): void {
  const { bitStart, bitEnd, label, attr } = st;
  const id = `field_${ctx.fieldIndex++}`;
  const length = bitEnd - bitStart + 1;
  const reserved = isReservedLabel(label);

  const field: PacketdiagField = {
    id,
    label: reserved ? label.trim() : label.trim(),
    bitStart,
    bitEnd,
    length,
    isReserved: reserved || undefined,
  };

  applyAttr(field, attr);
  ctx.model.fields.push(field);

  // Update cursor for subsequent list-form fields
  ctx.bitCursor = bitEnd + 1;
}

function t_fieldList(ctx: ParseContext, st: any): void {
  const { label, attr } = st;
  const id = `field_${ctx.fieldIndex++}`;

  // Length is required for list form; default to 0 if missing
  const length = attr.len ? parseInt(String(attr.len), 10) || 0 : 0;
  delete attr.len; // consumed

  const reserved = isReservedLabel(label);

  const field: PacketdiagField = {
    id,
    label: reserved ? label.trim() : label.trim(),
    bitStart: ctx.bitCursor,
    bitEnd: ctx.bitCursor + length - 1,
    length,
    isReserved: reserved || undefined,
  };

  applyAttr(field, attr);
  ctx.model.fields.push(field);

  ctx.bitCursor += length;
}

function t_config(ctx: ParseContext, st: any): void {
  const { key, value } = st;
  const cfg = ctx.model.config as Record<string, unknown>;

  switch (key) {
    case 'colwidth':
      cfg.colwidth = parseInt(value, 10) || undefined;
      break;
    case 'node_height':
      cfg.nodeHeight = parseInt(value, 10) || undefined;
      break;
    case 'scale_interval':
      cfg.scaleInterval = parseInt(value, 10) || undefined;
      break;
    case 'scale_direction':
      if (value === 'rtl' || value === 'ltr') {
        cfg.scaleDirection = value;
      }
      break;
    case 'same_height':
      cfg.sameHeight = value === 'true';
      break;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Detect parenthesized labels like "(Options and Padding)" */
function isReservedLabel(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('(') && trimmed.endsWith(')');
}

/** Strip matching double-quotes from an attribute value captured by PEG. */
function stripQuotes(v: string): string {
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1);
  return s;
}

/** Apply parsed [key=value] attributes onto a field */
function applyAttr(field: PacketdiagField, attr: Record<string, string>): void {
  if (!attr) return;

  if (attr.rotate) {
    const v = parseInt(String(attr.rotate), 10);
    if (!isNaN(v)) field.rotate = v;
  }
  if (attr.height || attr.colheight) {
    const v = parseInt(String(attr.height || attr.colheight), 10);
    if (!isNaN(v)) field.height = v;
  }
  if (attr.color) field.color = stripQuotes(String(attr.color));
  if (attr.textcolor) field.textColor = stripQuotes(String(attr.textcolor));
  if (attr.linecolor) field.lineColor = stripQuotes(String(attr.linecolor));
  if (attr.border) field.border = stripQuotes(String(attr.border));
  if (attr.description) field.description = stripQuotes(String(attr.description));
  if (attr.label) field.description = stripQuotes(String(attr.label)); // "label" attr is alias for description
}
