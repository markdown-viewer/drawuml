/**
 * Global renderer registry.
 *
 * All renderer modules register their factories here via registerRenderer().
 * Consumer code creates renderers by name via createRenderer().
 *
 * A single unified registry with factory signature:
 *   (desc: RenderDescriptor) => Renderer
 *
 * Descriptor hierarchy:
 *   RenderDescriptor (base — id, label, lines, bodyLines, color, style, stereotype, …)
 *     ├─ NodeDescriptor    (narrows label to required)
 *     └─ ElementDescriptor (semantic alias for auxiliary elements)
 */

import type { Renderer } from './renderer.ts';
import type { BodyLine } from '../model/class-model.ts';

// ---------------------------------------------------------------------------
// Descriptor hierarchy
// ---------------------------------------------------------------------------

/**
 * Base descriptor for all renderer factories.
 *
 * Common properties shared across node, group, and element renderers
 * are defined here (标题, 正文, 颜色, 样式, etc.).
 */
export interface RenderDescriptor {
  id: string;

  // ── Common display (标题 / 正文 / 颜色) ─────────────────────────────
  /** Display label / title text. */
  label?: string;
  /** Multi-line text content (for notes, legends). */
  lines?: string[];
  /** Rich body lines for class/entity body rendering. */
  bodyLines?: BodyLine[];
  /** Background/fill color override. */
  color?: string;
  /** Raw PlantUML style string, e.g. "#palegreen ##[dashed]green". */
  style?: string | null;
  /** Shape stereotype (e.g. 'folder', 'cloud', 'circle'). */
  stereotype?: string | null;

  // ── Node-specific ───────────────────────────────────────────────────
  /** Node type name (class, interface, enum, state, …). */
  type?: string;
  /** Human-readable stereotype label text. */
  stereotypeLabel?: string;
  /** Custom spot override from stereotype syntax, e.g. <<(S,#FF7700)>>. */
  spot?: { char: string; color: string };
  /** Suppress the spot circle in the title area. */
  hideCircle?: boolean;
  /** Hide field lines in the body. */
  hideFields?: boolean;
  /** Hide method lines in the body. */
  hideMethods?: boolean;
  /** Map entries for "map" blocks (key => value table rows). */
  mapEntries?: { key: string; value: string; linked?: boolean }[];
  /** User-defined $tags from class declaration syntax. */
  tags?: string[];
  /** Whether to show visibility icons in class body. */
  visibilityIcons?: boolean;
  /** Activity shape variant ('octagon'). */
  activityShape?: string;
  /** Actor style variant ('awesome' | 'hollow'). */
  actorStyle?: string;

  // ── Element-specific ────────────────────────────────────────────────
  /** Text alignment ('left' | 'center' | 'right'). */
  align?: string;
  /** Note sub-type: 'note' | 'hnote' | 'rnote'. */
  noteType?: string;
  /** Fixed height for frame tab, box label, etc. */
  fixedHeight?: number;
}

/**
 * Descriptor for semantic node renderers (class, state, deployment shapes, …).
 * Narrows `label` to required — every node has a display name.
 */
export interface NodeDescriptor extends RenderDescriptor {
  label: string;
}

/**
 * Descriptor for auxiliary element renderers (note, title, legend, frame, box).
 */
export interface ElementDescriptor extends RenderDescriptor {}

// ---------------------------------------------------------------------------
// Factory type alias
// ---------------------------------------------------------------------------

export type RendererFactory = (desc: RenderDescriptor) => Renderer;

// ---------------------------------------------------------------------------
// Internal registry (single unified map)
// ---------------------------------------------------------------------------

const registry = new Map<string, RendererFactory>();

// ---------------------------------------------------------------------------
// Registration API
// ---------------------------------------------------------------------------

export function registerRenderer(name: string, factory: RendererFactory): void {
  registry.set(name, factory);
}

// ---------------------------------------------------------------------------
// Creation API
// ---------------------------------------------------------------------------

export function createRenderer(name: string, desc: RenderDescriptor): Renderer {
  const factory = registry.get(name);
  if (!factory) throw new Error(`Unknown renderer: '${name}'`);
  return factory(desc);
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

export function hasRenderer(name: string): boolean {
  return registry.has(name);
}
