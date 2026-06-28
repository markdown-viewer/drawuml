/**
 * Packetdiag semantic model.
 *
 * Represents the parsed structure of a @startpacketdiag ... @endpacketdiag diagram.
 * Each field occupies a bit range on a 2D grid — no graph layout needed.
 */

// ── Field ────────────────────────────────────────────────────────────────────

export interface PacketdiagField {
  id: string;              // "field_0", "field_1", ...
  label: string;           // "Source Port" or stripped "(Options and Padding)"
  /** Bit range from range form `0-7: Label` */
  bitStart?: number;
  bitEnd?: number;
  /** Bit length from list form `* Label [len=16]` or computed from bitStart/bitEnd */
  length?: number;
  /** Per-field attributes from `[key=value, ...]` */
  rotate?: number;         // 270
  height?: number;         // row-height multiplier (colheight), default 1
  color?: string;          // "#FFD700"
  textColor?: string;      // "white"
  border?: string;         // "dashed"
  lineColor?: string;      // "red" — border/stroke color override
  description?: string;    // display text override (PlantUML: description=)
  /** Derived: true when label was wrapped in parentheses like `(Options)` */
  isReserved?: boolean;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface PacketdiagConfig {
  colwidth?: number;           // default 32
  nodeHeight?: number;         // default 48
  scaleDirection?: 'ltr' | 'rtl';  // default 'ltr'
  scaleInterval?: number;      // default 4
  sameHeight?: boolean;        // all fields same height as tallest
}

// ── Top-level model ──────────────────────────────────────────────────────────

export interface PacketdiagModel {
  fields: PacketdiagField[];
  config: PacketdiagConfig;
  title?: string;
}

// ── Layout result ────────────────────────────────────────────────────────────

export interface PacketdiagLayoutField extends PacketdiagField {
  row: number;
  bitOffset: number;       // starting bit position within the row
  x: number;
  y: number;
  w: number;
  h: number;
  displayLabel?: string;   // resolved label: description > label attr > original label
}

export interface PacketdiagLayoutResult {
  fields: PacketdiagLayoutField[];
  rowCount: number;
  totalWidth: number;
  totalHeight: number;
  colwidth: number;
  nodeHeight: number;
  maxBitsPerRow: number;
  scaleDirection: 'ltr' | 'rtl';
}
