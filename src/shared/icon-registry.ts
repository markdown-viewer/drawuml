// Icon registry for mxgraph shapes.
// Provides a typed lookup over the data generated from docs/shape-defaults.json.

import { iconData, IconRecord, IconVariant } from './icon-data.ts';

export type { IconRecord, IconVariant };

/** Strip the leading "mxgraph." prefix and split into path segments. */
function toSegments(shapeKey: string): string[] {
  const key = shapeKey.startsWith('mxgraph.') ? shapeKey.slice('mxgraph.'.length) : shapeKey;
  return key.split('.');
}

/**
 * Look up an mxgraph icon by its full dot-path key.
 * Supports both scalar icons and named variants within a variant group.
 *
 * @param shapeKey - Full dot-path, e.g. "mxgraph.aws4.compute.awsLambda"
 *                   or variant path "mxgraph.bpmn.event.start"
 * @returns The IconRecord if found, or undefined.
 *
 * @example
 *   lookupIcon('mxgraph.aws4.compute.awsLambda'); // { w: 78, h: 78 }
 *   lookupIcon('mxgraph.bpmn.event.start');        // { w: 20, h: 20 }
 */
export function lookupIcon(shapeKey: string): IconRecord | undefined {
  const parts = toSegments(shapeKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = iconData;
  for (let i = 0; i < parts.length; i++) {
    if (node == null) return undefined;
    // Reached a variant array — remaining segments form the variant name
    if (Array.isArray(node)) {
      const name = parts.slice(i).join('.');
      const variant: IconVariant | undefined = node.find((v: IconVariant) => v.name === name);
      if (!variant) return undefined;
      const { name: _n, ...record } = variant;
      return record as IconRecord;
    }
    if (typeof node !== 'object') return undefined;
    node = node[parts[i]];
  }
  // Scalar leaf
  return (node != null && !Array.isArray(node) && typeof node.w === 'number')
    ? (node as IconRecord)
    : undefined;
}

/**
 * Check whether a dot-path string refers to a registered mxgraph icon.
 *
 * @param shapeKey - Full dot-path, e.g. "mxgraph.cisco.computers_and_peripherals.laptop"
 */
export function hasIcon(shapeKey: string): boolean {
  return lookupIcon(shapeKey) !== undefined;
}

/**
 * Resolve the DrawIO "shape=" reference for a shapeKey.
 * For scalar icons the input is returned unchanged.
 * For variant icons (e.g. "mxgraph.bpmn.event.start"), the parent group key
 * ("mxgraph.bpmn.event") is returned, because that is the actual DrawIO shape;
 * the variant-specific parameters live in the icon's style fragment.
 *
 * @param shapeKey - Full dot-path, e.g. "mxgraph.bpmn.event.start"
 */
export function resolveShapeRef(shapeKey: string): string {
  const stripped = shapeKey.startsWith('mxgraph.') ? shapeKey.slice(8) : shapeKey;
  const parts = stripped.split('.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = iconData;
  for (let i = 0; i < parts.length; i++) {
    if (node == null || typeof node !== 'object') return shapeKey;
    node = node[parts[i]];
    if (Array.isArray(node)) {
      // parts[0..i] lead to the variant group — that is the real shape key
      return 'mxgraph.' + parts.slice(0, i + 1).join('.');
    }
  }
  return shapeKey;
}

/**
 * List all named variants for a variant-group key.
 * Returns undefined if the key does not point to a variant array.
 *
 * @param groupKey - Dot-path to the group, e.g. "mxgraph.bpmn.event"
 */
export function listVariants(groupKey: string): IconVariant[] | undefined {
  const parts = toSegments(groupKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = iconData;
  for (const p of parts) {
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = node[p];
  }
  return Array.isArray(node) ? (node as IconVariant[]) : undefined;
}
