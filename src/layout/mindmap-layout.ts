/**
 * Mindmap layout engine.
 *
 * Implements a recursive tree layout that positions nodes in a horizontal
 * (LR) or vertical (TB) tree structure. Each node's children are stacked
 * perpendicular to the growth direction and centered around the parent.
 *
 * The layout works in two passes:
 *   1. Measure: compute subtree sizes bottom-up
 *   2. Position: assign coordinates top-down
 */

import type { MindmapModel, MindmapNode } from '../parsers/mindmap.ts';
import type { Theme } from '../shared/theme.ts';
import { createTheme } from '../shared/theme.ts';
import { TextBlock, type FontSpec } from '../shared/text-block.ts';
import type { Renderer } from '../primitives/renderer.ts';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MindmapLayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MindmapLayoutEdge {
  fromId: string;
  toId: string;
  /** Branch side: determines exit/entry port direction. */
  side: 'left' | 'right' | 'bottom' | 'top';
}

export interface MindmapLayoutResult {
  nodes: Record<string, MindmapLayoutNode>;
  edges: MindmapLayoutEdge[];
  width: number;
  height: number;
}

export interface MindmapLayoutOptions {
  theme?: Theme;
  renderers?: Map<string, Renderer>;
}

// ── Internal sizing ──────────────────────────────────────────────────────────

/** T-shape abstraction for collision-based layout (like PlantUML Tetris). */
interface TeeShape {
  /** Node's own thickness in stacking direction. */
  thickness1: number;
  /** Node's own elongation in growth direction (includes hGap if has children). */
  elongation1: number;
  /** Children stack thickness (0 for leaf nodes). */
  thickness2: number;
  /** Children max elongation (0 for leaf nodes). */
  elongation2: number;
}

interface SizedNode {
  node: MindmapNode;
  width: number;
  height: number;
  /** Per-node sibling spacing used for Tetris inflation. */
  pad: number;
  /** T-shape for collision-based sibling placement. */
  tee: TeeShape;
  /** Total subtree extent in the stacking direction (perpendicular to growth). */
  subtreeThickness: number;
  /** Total subtree extent in the growth direction. */
  subtreeElongation: number;
  children: SizedNode[];
}

interface Spacing {
  hGap: number;
  /** Default sibling pad for normal nodes. */
  nodePad: number;
  /** Sibling pad for boxless nodes (half of nodePad). */
  boxlessPad: number;
  padX: number;
  padY: number;
  minW: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function mindmapLayout(model: MindmapModel, options?: MindmapLayoutOptions): MindmapLayoutResult {
  const theme = options?.theme ?? createTheme();
  const font: FontSpec = { size: theme.fontSize, family: theme.fontFamily };
  const renderers = options?.renderers;

  // Spacing from theme
  const hGap = theme.padXXL;        // horizontal gap between parent and children (40 @12)
  const nodePad = theme.padL;                          // sibling pad for normal nodes (20 @12)
  const boxlessPad = 0;                                // sibling pad for boxless nodes
  const padX = theme.contentPad;    // horizontal padding inside node box (10 @12)
  const padY = theme.edgeGap;       // vertical padding inside node box (5 @12)
  const minW = theme.arcSize;       // minimum node width (10 @12)

  const sp: Spacing = { hGap, nodePad, boxlessPad, padX, padY, minW };

  if (model.roots.length === 0) {
    return { nodes: {}, edges: [], width: 0, height: 0 };
  }

  const isVertical = model.direction === 'TB';

  // Layout each root tree independently, then stack vertically
  const allNodes: Record<string, MindmapLayoutNode> = {};
  const allEdges: MindmapLayoutEdge[] = [];
  let offsetY = 0;

  for (const root of model.roots) {
    const result = layoutSingleRoot(root, model.direction, isVertical, font, sp, renderers, hGap);
    // Offset all nodes by current Y position
    for (const n of Object.values(result.nodes)) {
      n.y += offsetY;
      allNodes[n.id] = n;
    }
    allEdges.push(...result.edges);
    offsetY += result.height + sp.nodePad;
  }

  // Compute final bounding box
  let maxW = 0, maxH = 0;
  for (const n of Object.values(allNodes)) {
    maxW = Math.max(maxW, n.x + n.width);
    maxH = Math.max(maxH, n.y + n.height);
  }

  return { nodes: allNodes, edges: allEdges, width: maxW, height: maxH };
}

// ── Single root layout ──────────────────────────────────────────────────────

function layoutSingleRoot(
  root: MindmapNode,
  direction: string,
  isVertical: boolean,
  font: FontSpec,
  sp: Spacing,
  renderers: Map<string, Renderer> | undefined,
  hGap: number,
): MindmapLayoutResult {

  // Separate children into left and right branches
  const rightChildren: MindmapNode[] = [];
  const leftChildren: MindmapNode[] = [];
  for (const child of root.children) {
    if (child.side === 'left') {
      leftChildren.push(child);
    } else {
      rightChildren.push(child);
    }
  }

  // Measure all nodes
  const rightSized = rightChildren.map(c => measureSubtree(c, font, isVertical, sp, renderers));
  const leftSized = leftChildren.map(c => measureSubtree(c, font, isVertical, sp, renderers));
  const rootSize = measureNode(root, font, sp, renderers);

  // Compute subtree dimensions via Tetris collision layout
  const rightTetris = tetrisPlace(rightSized);
  const leftTetris = tetrisPlace(leftSized);
  const rightTotal = {
    thickness: rightTetris.totalThickness,
    elongation: rightSized.length > 0 ? Math.max(...rightSized.map(c => c.subtreeElongation)) : 0,
  };
  const leftTotal = {
    thickness: leftTetris.totalThickness,
    elongation: leftSized.length > 0 ? Math.max(...leftSized.map(c => c.subtreeElongation)) : 0,
  };

  // Position root at center
  const nodes: Record<string, MindmapLayoutNode> = {};
  const edges: MindmapLayoutEdge[] = [];

  if (isVertical) {
    // TB layout: right-side children go BELOW, left-side children go ABOVE
    const totalWidth = Math.max(rootSize.width, rightTotal.thickness, leftTotal.thickness);

    const rootX = totalWidth / 2 - rootSize.width / 2;
    const rootCenterX = rootX + rootSize.width / 2;

    // Compute vertical extents for root positioning
    const aboveElongation = leftTotal.elongation > 0 ? leftTotal.elongation + hGap : 0;
    const rootY = aboveElongation;
    nodes[root.id] = { id: root.id, x: rootX, y: rootY, width: rootSize.width, height: rootSize.height };

    // Right-side children go BELOW the root
    if (rightSized.length > 0) {
      const startY = rootY + rootSize.height + hGap;
      positionChildrenVertical(rightSized, rootCenterX, startY, 1, nodes, edges, root.id, sp);
    }
    // Left-side children go ABOVE the root
    if (leftSized.length > 0) {
      const startY = rootY - hGap;
      positionChildrenVertical(leftSized, rootCenterX, startY, -1, nodes, edges, root.id, sp);
    }
  } else {
    // LR/RL layout: for RL, right-children grow LEFT and left-children grow RIGHT
    const rightDir: 'left' | 'right' = direction === 'RL' ? 'left' : 'right';
    const leftDir: 'left' | 'right' = direction === 'RL' ? 'right' : 'left';

    // Space to the LEFT of root comes from whichever group grows leftward
    const leftGrowElongation = rightDir === 'left' ? rightTotal.elongation : leftTotal.elongation;
    const leftGrowHasChildren = rightDir === 'left' ? rightSized.length > 0 : leftSized.length > 0;

    const centerThickness = Math.max(rootSize.height, rightTotal.thickness, leftTotal.thickness);

    const rootX = leftGrowElongation + (leftGrowHasChildren ? hGap : 0);
    const rootY = centerThickness / 2 - rootSize.height / 2;
    nodes[root.id] = { id: root.id, x: rootX, y: rootY, width: rootSize.width, height: rootSize.height };

    // Position right children in their direction
    if (rightSized.length > 0) {
      const startX = rightDir === 'right' ? rootX + rootSize.width + hGap : rootX - hGap;
      const centerY = rootY + rootSize.height / 2;
      positionChildrenHorizontal(rightSized, startX, centerY, rightDir, nodes, edges, root.id, sp);
    }

    // Position left children in their direction
    if (leftSized.length > 0) {
      const startX = leftDir === 'right' ? rootX + rootSize.width + hGap : rootX - hGap;
      const centerY = rootY + rootSize.height / 2;
      positionChildrenHorizontal(leftSized, startX, centerY, leftDir, nodes, edges, root.id, sp);
    }
  }

  // Compute bounding box and normalize coordinates to positive
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of Object.values(nodes)) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }

  // Shift everything so top-left is at (0, 0)
  if (minX < 0 || minY < 0) {
    const dx = minX < 0 ? -minX : 0;
    const dy = minY < 0 ? -minY : 0;
    for (const n of Object.values(nodes)) {
      n.x += dx;
      n.y += dy;
    }
    maxX += dx;
    maxY += dy;
  }

  return { nodes, edges, width: maxX, height: maxY };
}

// ── Measurement ──────────────────────────────────────────────────────────────

function measureNode(node: MindmapNode, font: FontSpec, sp: Spacing, renderers?: Map<string, Renderer>): { width: number; height: number } {
  // Use renderer.measure() when available (includes all padding)
  const r = renderers?.get(node.id);
  if (r) return r.measure();

  // Fallback: manual measurement
  if (!node.label) {
    return { width: sp.minW + sp.padX * 2, height: font.size + sp.padY * 2 };
  }
  const tb = node.label.includes('\n')
    ? TextBlock.block(node.label, font)
    : TextBlock.inline(node.label, font);
  const size = tb.measure();
  const w = Math.max(sp.minW, size.width) + sp.padX * 2;
  const h = size.height + sp.padY * 2;
  return { width: Math.ceil(w), height: Math.ceil(h) };
}

function measureSubtree(node: MindmapNode, font: FontSpec, isVertical: boolean, sp: Spacing, renderers?: Map<string, Renderer>): SizedNode {
  const size = measureNode(node, font, sp, renderers);
  const children = node.children.map(c => measureSubtree(c, font, isVertical, sp, renderers));
  const pad = node.boxless ? sp.boxlessPad : sp.nodePad;

  const nodeThk = isVertical ? size.width : size.height;
  const nodeElg = isVertical ? size.height : size.width;

  // Include pad in thickness1 so inter-sibling gap is built into the
  // T-shape (like PlantUML bakes margin into phalanx dimensions).
  const paddedThk = nodeThk + pad;

  if (children.length === 0) {
    const tee: TeeShape = { thickness1: paddedThk, elongation1: nodeElg, thickness2: 0, elongation2: 0 };
    return { node, ...size, pad, tee, children, subtreeThickness: nodeThk, subtreeElongation: nodeElg };
  }

  const tetris = tetrisPlace(children);
  const childStackThk = tetris.totalThickness;
  const childMaxElg = Math.max(...children.map(c => c.subtreeElongation));

  const tee: TeeShape = {
    thickness1: paddedThk,
    elongation1: nodeElg + sp.hGap,
    thickness2: childStackThk,
    elongation2: childMaxElg,
  };

  const subtreeThickness = Math.max(nodeThk, childStackThk);
  const subtreeElongation = nodeElg + sp.hGap + childMaxElg;

  return { node, ...size, pad, tee, children, subtreeThickness, subtreeElongation };
}

// ── Tetris-based collision layout ────────────────────────────────────────────

/** 1-D interval frontier tracking the maximum y for each x-range. */
class StripeFrontier {
  private segs: { x1: number; x2: number; y: number }[] = [];

  getContact(x1: number, x2: number): number {
    if (x1 >= x2) return -Infinity;
    let max = -Infinity;
    for (const s of this.segs) {
      if (s.x2 > x1 && s.x1 < x2) max = Math.max(max, s.y);
    }
    return max;
  }

  addSegment(x1: number, x2: number, y: number): void {
    if (x1 < x2) this.segs.push({ x1, x2, y });
  }
}

/**
 * Place siblings using collision-based Tetris layout.
 *
 * Each child's T-shape has two segments (node and children subtree) at
 * different depths.  A leaf node has only segment 1.  The frontier tracks
 * the bottom edges so a following leaf can slide up alongside the previous
 * node's children when they don't overlap in depth.
 *
 * Returns per-child offsets (center positions relative to group center)
 * and the total visual thickness.
 */
function tetrisPlace(children: SizedNode[]): { offsets: number[]; totalThickness: number } {
  if (children.length === 0) return { offsets: [], totalThickness: 0 };

  const frontier = new StripeFrontier();
  const centers: number[] = [];

  // First child placed at center=0 (like PlantUML).
  const first = children[0].tee;
  centers.push(0);
  frontier.addSegment(0, first.elongation1, first.thickness1 / 2);
  if (first.thickness2 > 0) {
    frontier.addSegment(first.elongation1, first.elongation1 + first.elongation2, first.thickness2 / 2);
  }

  // Subsequent children via collision detection.
  // thickness1 already includes pad, so zero-gap Tetris produces
  // the correct inter-node spacing.
  for (let i = 1; i < children.length; i++) {
    const { tee } = children[i];

    const c1 = frontier.getContact(0, tee.elongation1);
    const c2 = tee.elongation2 > 0
      ? frontier.getContact(tee.elongation1, tee.elongation1 + tee.elongation2)
      : -Infinity;

    // Position T so segment tops are at/below their respective contacts.
    // For segment1: top = y - t1/2 ≥ c1  →  y ≥ c1 + t1/2
    // For segment2: top = y - t2/2 ≥ c2  →  y ≥ c2 + t2/2
    const y = Math.max(
      c1 + tee.thickness1 / 2,
      tee.thickness2 > 0 ? c2 + tee.thickness2 / 2 : -Infinity,
    );
    centers.push(y);

    frontier.addSegment(0, tee.elongation1, y + tee.thickness1 / 2);
    if (tee.thickness2 > 0) {
      frontier.addSegment(tee.elongation1, tee.elongation1 + tee.elongation2, y + tee.thickness2 / 2);
    }
  }

  // Balance: center the group using full T extents (like PlantUML Tetris.balance)
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < children.length; i++) {
    const t = children[i].tee;
    const halfMax = Math.max(t.thickness1, t.thickness2) / 2;
    minY = Math.min(minY, centers[i] - halfMax);
    maxY = Math.max(maxY, centers[i] + halfMax);
  }
  const mid = (minY + maxY) / 2;

  return {
    offsets: centers.map(c => c - mid),
    totalThickness: maxY - minY,
  };
}

// ── Positioning ──────────────────────────────────────────────────────────────

function positionChildrenHorizontal(
  children: SizedNode[],
  startX: number,
  centerY: number,
  direction: 'left' | 'right',
  nodes: Record<string, MindmapLayoutNode>,
  edges: MindmapLayoutEdge[],
  parentId: string,
  sp: Spacing,
) {
  const tetris = tetrisPlace(children);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const offset = tetris.offsets[i];
    const nodeY = centerY + offset - child.height / 2;
    const nodeX = direction === 'right' ? startX : startX - child.width;

    nodes[child.node.id] = { id: child.node.id, x: nodeX, y: nodeY, width: child.width, height: child.height };
    edges.push({ fromId: parentId, toId: child.node.id, side: direction });

    if (child.children.length > 0) {
      const nextStartX = direction === 'right' ? nodeX + child.width + sp.hGap : nodeX - sp.hGap;
      positionChildrenHorizontal(child.children, nextStartX, centerY + offset, direction, nodes, edges, child.node.id, sp);
    }
  }
}

function positionChildrenVertical(
  children: SizedNode[],
  centerX: number,
  startY: number,
  growDir: 1 | -1,
  nodes: Record<string, MindmapLayoutNode>,
  edges: MindmapLayoutEdge[],
  parentId: string,
  sp: Spacing,
) {
  const tetris = tetrisPlace(children);
  const edgeSide: 'bottom' | 'top' = growDir === 1 ? 'bottom' : 'top';

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const offset = tetris.offsets[i];
    const nodeX = centerX + offset - child.width / 2;
    const nodeY = growDir === 1 ? startY : startY - child.height;

    nodes[child.node.id] = { id: child.node.id, x: nodeX, y: nodeY, width: child.width, height: child.height };
    edges.push({ fromId: parentId, toId: child.node.id, side: edgeSide });

    if (child.children.length > 0) {
      const nextY = growDir === 1 ? nodeY + child.height + sp.hGap : nodeY - sp.hGap;
      positionChildrenVertical(child.children, centerX + offset, nextY, growDir, nodes, edges, child.node.id, sp);
    }
  }
}


