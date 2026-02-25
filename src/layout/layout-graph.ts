/**
 * Layout Graph IR — engine-agnostic intermediate representation.
 *
 * `LayoutGraphNode` is the unified data structure that Renderers produce
 * (via `buildLayoutGraph()`) and layout engine adapters consume.
 *
 * Design: closely aligned with ELK JSON so that the ELK adapter is a
 * near-trivial mapping, while the DOT adapter re-derives the DOT string
 * from the same structured data.
 */

// ─── Port ────────────────────────────────────────────────────────────────────

/** A port on a layout node (for field-level edge routing). */
export interface LayoutPort {
  /** Unique port ID (typically `nodeId::fieldName`). */
  id: string;
  /** Port width in pixels. */
  width: number;
  /** Port height in pixels. */
  height: number;
  /** Relative Y offset within the parent node. */
  y?: number;
}

// ─── Label ───────────────────────────────────────────────────────────────────

/** An external label placed outside the node bounding box (xlabel in DOT). */
export interface LayoutLabel {
  /** Label text. */
  text: string;
  /** Label width in pixels. */
  width: number;
  /** Label height in pixels. */
  height: number;
  /** Preferred ELK placement hint (e.g. 'OUTSIDE H_LEFT V_TOP'). */
  placement?: string;
}

// ─── Node ────────────────────────────────────────────────────────────────────

/** A graph node for the layout engine (ELK JSON compatible). */
export interface LayoutGraphNode {
  /** Unique node ID. */
  id: string;
  /** Node width in pixels. */
  width: number;
  /** Node height in pixels. */
  height: number;
  /** Display label text (used as DOT cluster label or ELK node label). */
  label?: string;
  /** Child nodes — present for container/cluster nodes. */
  children?: LayoutGraphNode[];
  /** Ports for field-level edge routing. */
  ports?: LayoutPort[];
  /** External labels (xlabel in DOT, OUTSIDE label in ELK). */
  labels?: LayoutLabel[];
  /** Per-node layout options (engine-specific, passed through by adapters). */
  layoutOptions?: Record<string, string | number>;
  /** Container padding (for cluster nodes). */
  padding?: { top: number; right: number; bottom: number; left: number };
}
