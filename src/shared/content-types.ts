/**
 * Content types — pure type definitions and utility functions
 * shared across block-layout, renderers, and other primitives.
 *
 * Extracted from content.ts to decouple type-only consumers from
 * the BlockLayout implementation.
 */

import type { TextBlock } from './text-block.ts';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Internal content block — each block holds a TextBlock for consistent measure/render. */
export type ContentBlock =
  | { kind: 'title'; text: TextBlock }
  | { kind: 'row'; text: TextBlock; id?: string }
  | { kind: 'separator'; variant: string; titleText?: TextBlock }
  | { kind: 'rich'; text: TextBlock };

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

/**
 * Options controlling how child cell styles are built inside renderChildren.
 * When BlockLayout holds a theme, these options fine-tune the generated styles.
 */
/** Returns separator x and width at a given vertical center y within the shape. */
export type SeparatorBoundsFn = (centerY: number) => { x: number; width: number };

export interface ChildStyleOpts {
  /** Container fill color — used for separator label background */
  fillColor?: string;
  /** Container stroke color — used for separator line color */
  strokeColor?: string;
  /** Custom separator bounds function for non-rectangular shapes */
  separatorBounds?: SeparatorBoundsFn;
  /** Child row/separator stroke color inheritance (class-node skinparam) */
  childStroke?: string;
  /** Child row/separator line style inheritance (class-node skinparam) */
  childLineStyle?: string;
  /** Append portConstraint=eastwest on row and separator cells (swimlane) */
  portConstraint?: boolean;
  /** Row text alignment override (default: 'left') */
  align?: 'left' | 'center' | 'right';
  /** Row spacingLeft/spacingRight override */
  spacingX?: number;
  /** Row font color override */
  fontColor?: string;
}

/**
 * Context passed to the finalizeBody callback in BlockLayout.classBody().
 * Allows renderers to customize auto-separator behavior per entity type
 * without BlockLayout needing to know about specific entity types.
 */
export interface FinalizeBodyCtx {
  /** Mutable content blocks — callback may modify in-place. */
  blocks: ContentBlock[];
  /** Processed body lines (after filtering). */
  lines: import('../model/class-model.ts').BodyLine[];
  /** Whether an explicit separator was found in body lines. */
  hasSeparator: boolean;
  hideFields?: boolean;
  hideMethods?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Style string for separator line child mxCells.
 *
 * Centralised here so all renderers (class-node, state-node, rich-renderer,
 * participant) share a single definition.  Optional extras allow swimlane
 * renderers to append portConstraint and per-entity stroke/lineStyle.
 */
export function separatorStyle(opts?: {
  strokeColor?: string;
  lineStyle?: string;
  strokeWidth?: number;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  /** Append portConstraint=eastwest (swimlane class/state nodes). */
  portConstraint?: boolean;
}): string {
  const sw = opts?.strokeWidth ?? 1;
  const parts = [
    'line',
    `strokeWidth=${sw}`,
    'align=left',
    'verticalAlign=middle',
    'spacingTop=-1',
    'spacingLeft=3',
    'spacingRight=3',
    'rotatable=0',
    'labelPosition=right',
    'points=[]',
  ];
  if (opts?.portConstraint) parts.push('portConstraint=eastwest');
  if (opts?.strokeColor) parts.push(`strokeColor=${opts.strokeColor}`);
  if (opts?.lineStyle === 'dashed') parts.push('dashed=1');
  else if (opts?.lineStyle === 'dotted') parts.push('dashed=1', 'dashPattern=1 2');
  else if (opts?.lineStyle === 'bold') parts.push(`strokeWidth=${sw * 2}`);
  if (opts?.fontSize) parts.push(`fontSize=${opts.fontSize}`);
  if (opts?.fontFamily) parts.push(`fontFamily=${opts.fontFamily}`);
  if (opts?.fontColor) parts.push(`fontColor=${opts.fontColor}`);
  return parts.join(';') + ';';
}

/**
 * Build a DrawIO style string for rich text child cells.
 */
export function richTextStyle(spacingLeft: number, spacingRight: number, align: 'left' | 'center' | 'right' = 'left', fontSize?: number, fontFamily?: string, fontColor?: string): string {
  const parts = [
    'text', 'html=1', 'strokeColor=none', 'fillColor=none',
    `align=${align}`, 'verticalAlign=middle',
    `spacingLeft=${spacingLeft}`, `spacingRight=${spacingRight}`,
    'whiteSpace=wrap', 'overflow=hidden', 'rotatable=0',
  ];
  if (fontSize) parts.push(`fontSize=${fontSize}`);
  if (fontFamily) parts.push(`fontFamily=${fontFamily}`);
  if (fontColor) parts.push(`fontColor=${fontColor}`);
  return parts.join(';') + ';';
}
