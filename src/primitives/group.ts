/**
 * Group utilities — shape resolution for container renderers
 * (package / namespace / rectangle / frame / folder / …).
 *
 * Style rendering is handled by individual shape renderers in shapes/.
 * This file provides:
 *   - resolveGroupShape() — resolve group type/stereotype to shape name
 */

import { hasRenderer } from './registry.ts';

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

