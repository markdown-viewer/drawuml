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
import { DOT_NODESEP_PX } from '../shared/theme.ts';

/** Warning item for unimplemented shapes (matches RenderWarning in index.ts). */
interface ShapeWarning {
  type: string;
  nodeId: string;
  stereotype: string;
  message: string;
}

// Use a late-binding reference to avoid circular import:
// group.ts is imported by index.ts, which defines _renderWarnings.
// We access the warnings array via a getter exported from index.ts.
let _getWarnings: (() => ShapeWarning[]) | null = null;

/** @internal Called by index.ts to wire up the warnings collector. */
export function _setWarningsGetter(fn: () => ShapeWarning[]): void {
  _getWarnings = fn;
}

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
  groupId?: string,
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

  // Warn when falling back to 'folder' for a non-package type.
  // 'package' and 'namespace' legitimately default to folder.
  const FOLDER_DEFAULT_TYPES = new Set(['package', 'namespace', 'folder', '']);
  if (!FOLDER_DEFAULT_TYPES.has(type) && _getWarnings) {
    _getWarnings().push({
      type: 'unimplemented_shape',
      nodeId: groupId || type,
      stereotype: stereotype || type,
      message: `Unimplemented group shape '${stereotype || type}' for group '${groupId || type}', falling back to folder`,
    });
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
  // Enlarge the wrapper margin when the group has external edges to sibling nodes,
  // so the group has enough space for external routing (e.g. snapped ports, or direct edges).
  const portChildren = children.filter(c => c.isPort);
  const normalChildren = children.filter(c => !c.isPort);
  const outerMargin = ctx.hasExternalEdge(id)
    ? DOT_NODESEP_PX
    : 8;
  lines.push(`${indent}subgraph "cluster_${id}_p0" {`);
  lines.push(`${indent}  label=""`);
  lines.push(`${indent}  margin="${outerMargin}"`);

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

  // All children (leaf nodes and nested containers alike).
  // Port children are included so DOT places them inside the cluster — this
  // ensures internal edges (port→child) route correctly without leaving the cluster.
  // snapPortNodes() moves their rendered position to the boundary afterwards.
  for (const child of children) {
    lines.push(...child.buildDotBlock(ctx, inner + '  '));
  }

  // rank=source pins portin nodes to the cluster's top rank (near the top boundary)
  const portinIds = portChildren.filter(c => c.portKind !== 'portout').map(c => `"${c.id}"`);
  if (portinIds.length > 0) {
    lines.push(`${inner}  {rank=source; ${portinIds.join('; ')}}`);
  }
  // rank=sink pins portout nodes to the cluster's bottom rank (near the bottom boundary)
  const portoutIds = portChildren.filter(c => c.portKind === 'portout').map(c => `"${c.id}"`);
  if (portoutIds.length > 0) {
    lines.push(`${inner}  {rank=sink; ${portoutIds.join('; ')}}`);
  }

  // Row-packing: only pack non-port, non-cluster (leaf) normal children
  const leafNormal = normalChildren.filter(c => !c.isCluster);
  const totalItems = normalChildren.length;
  const targetCols = Math.max(Math.ceil(Math.sqrt(totalItems)), 2);
  const leafIds = leafNormal.map(r => r.id);
  lines.push(...ctx.buildRowPacking(leafIds, inner + '  ', 700, targetCols));

  lines.push(`${inner}}`);
  lines.push(`${indent}}`);
  return lines;
}
