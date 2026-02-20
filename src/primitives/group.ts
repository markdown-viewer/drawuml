/**
 * Group utilities — shape resolution and DOT cluster builder for
 * container renderers (package / namespace / rectangle / frame / folder / …).
 *
 * Style rendering is handled by individual shape renderers in shapes/.
 * This file provides:
 *   - resolveGroupShape() — resolve group type/stereotype to shape name
 *   - buildClusterDotBlock() — shared DOT subgraph cluster generation
 */

import { Renderer } from './renderer.ts';
import type { DotContext } from './renderer.ts';
import { hasRenderer } from './registry.ts';

// ---------------------------------------------------------------------------
// Shape resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective group shape from group type, stereotype, and global
 * skinparam packageStyle.
 *
 * Shape names (including aliases like 'rect') are validated against the
 * renderer registry — aliases are registered at shape registration time.
 *
 * Priority: per-group stereotype > group type keyword > global packageStyle > default (folder).
 */
export function resolveGroupShape(
  type: string,
  stereotype?: string,
  globalPackageStyle?: string,
): string {
  // Per-group stereotype takes highest priority (e.g., package <<Cloud>>)
  if (stereotype) {
    const key = stereotype.toLowerCase();
    if (hasRenderer(key)) return key;
  }
  // Group type keyword (e.g., "frame foo {}", "cloud bar {}")
  if (hasRenderer(type)) return type;
  // Global skinparam packageStyle
  if (globalPackageStyle) {
    const key = globalPackageStyle.toLowerCase();
    if (hasRenderer(key)) return key;
  }
  // Default
  return 'folder';
}

// ---------------------------------------------------------------------------
// Shared DOT cluster builder
// ---------------------------------------------------------------------------

/**
 * Build a DOT subgraph cluster block for a container renderer.
 *
 * This is a free function so that any renderer managing children
 * (GroupRenderer, StateNodeRenderer, …) can reuse the same cluster logic.
 */
export function buildClusterDotBlock(
  id: string,
  label: string,
  children: Renderer[],
  ctx: DotContext,
  indent: string,
): string[] {
  const lines: string[] = [];
  // Outer protection subgraph increases inter-cluster spacing
  // (mirrors PlantUML's "p0" wrapper — Graphviz's default cluster margin
  //  enlarges the bounding box, pushing adjacent clusters apart)
  lines.push(`${indent}subgraph "cluster_${id}_p0" {`);
  lines.push(`${indent}  label=""`);

  const inner = indent + '  ';
  lines.push(`${inner}subgraph "cluster_${id}" {`);
  lines.push(`${inner}  label="${label}"`);
  lines.push(`${inner}  style=rounded`);
  lines.push(`${inner}  margin="20"`);

  // Add invisible proxy node for compound edges targeting this group
  if (ctx.needsProxy(id)) {
    lines.push(`${inner}  "__proxy_${id}" [shape=point,width=0.01,height=0.01,style=invis,label=""]`);
  }

  // Ensure empty clusters get a bounding box
  const hasContent = children.length > 0 || ctx.needsProxy(id);
  if (!hasContent) {
    lines.push(`${inner}  "__empty_${id}" [shape=point,width=0.01,height=0.01,style=invis,label=""]`);
  }

  // All children (leaf nodes and nested containers alike)
  for (const child of children) {
    lines.push(...child.buildDotBlock(ctx, inner + '  '));
  }

  // Row-packing: only pack non-cluster (leaf) children
  const leafChildren = children.filter(c => !c.isCluster);
  const totalItems = children.length;
  const targetCols = Math.max(Math.ceil(Math.sqrt(totalItems)), 2);
  const leafIds = leafChildren.map(r => r.id);
  lines.push(...ctx.buildRowPacking(leafIds, inner + '  ', 700, targetCols));

  lines.push(`${inner}}`);
  lines.push(`${indent}}`);
  return lines;
}
