/**
 * ELK layout engine — drives elkjs to produce node coordinates
 * and edge waypoints for DrawIO rendering.
 *
 * Counterpart of the DOT engine in dot-layout.ts.
 * Uses async API (elk.layout returns a Promise) for browser compatibility.
 */

import ELK from 'elkjs';
import type { LayoutResult } from '../../model/index.ts';
import type { SemanticModel } from '../../model/index.ts';
import { Renderer } from '../../primitives/renderer.ts';
import { createRenderers, buildRendererTree } from '../renderer-tree.ts';
import { snapPortNodes, alignFieldNotes, positionTitle, rearrangeSwimlanes, separateOverlappingEdges } from '../post-process.ts';
import { layoutGraphToElk, layoutGraphToElkSimple } from './elk-adapter.ts';
import { extractElkLayout } from './elk-extractor.ts';
import { dotLayout } from '../dot-layout.ts';

// ---------------------------------------------------------------------------
// ELK instance management
// ---------------------------------------------------------------------------

let elkInstance: any = null;

function getElk() {
  if (!elkInstance) {
    elkInstance = new ELK();
  }
  return elkInstance;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Layout output including stateful renderers for the generation phase. */
export interface ElkLayoutResult {
  layout: LayoutResult;
  renderers: Map<string, Renderer>;
}

import { createTheme, type Theme } from '../../shared/theme.ts';

/**
 * Lay out a SemanticModel using the ELK layered algorithm.
 * Returns layout coordinates and pre-built renderers for generation.
 */
export async function elkLayout(model: SemanticModel, options?: { theme?: Theme }): Promise<ElkLayoutResult> {
  // Swimlane diagrams: fallback to DOT layout with ortho edges + edge fix
  const hasSwimlanes = (model.groups || []).some(
    g => g.type === 'swimlane_container' && g.concurrentRegions && g.concurrentRegions.length > 1
  );
  if (hasSwimlanes) {
    return dotLayout(model, { ortho: true, theme: options?.theme });
  }

  const elk = getElk();

  // 1. Create renderers for each node
  const renderers = createRenderers(model, { theme: options?.theme });

  // 2. Build renderer tree (groups hold child renderers)
  const rootRenderers = buildRendererTree(model, renderers, { theme: options?.theme });

  // 3. Build LayoutGraphNode IR
  const rootNodes = rootRenderers.map(r => r.buildLayoutGraph());

  // 4. Pass 1 — run ELK without port constraints to get node positions
  const simpleGraph = layoutGraphToElkSimple(rootNodes, model, renderers, options?.theme);
  const pass1Result = await elk.layout(simpleGraph);

  // Extract node center positions from pass 1
  const nodePositions = new Map<string, { cx: number; cy: number }>();
  collectNodePositions(pass1Result, 0, 0, nodePositions);

  // 5. Pass 2 — build ELK graph with position-aware port assignment
  const elkGraph = layoutGraphToElk(rootNodes, model, renderers, nodePositions, options?.theme);

  // 6. Collect group IDs for edge group detection
  const groupIds = new Set<string>();
  if (model.groups) {
    for (const g of model.groups) {
      groupIds.add(g.id);
    }
  }

  // 7. Run ELK layout pass 2 (async — returns a Promise)
  const elkResult = await elk.layout(elkGraph);

  // 8. Extract layout result
  const theme = options?.theme ?? createTheme();
  const layout = extractElkLayout(elkResult, model.edges, renderers, groupIds);

  // 9. Enforce minimum edge-edge spacing (ELK doesn't guarantee it for cross-hierarchy edges)
  separateOverlappingEdges(layout, theme.padXS);

  // 10. Swimlane column rearrangement (if activity swimlanes present)
  rearrangeSwimlanes(layout, model, theme);

  // 11. Post-processing (shared with DOT engine)
  // Build set of port node IDs that were laid out as ELK ports — these
  // already have correct positions and should not be re-snapped.
  const elkPortIds = new Set<string>();
  for (const g of model.groups || []) {
    for (const childId of g.children) {
      const r = renderers.get(childId);
      if (r?.isPort) elkPortIds.add(childId);
    }
  }
  snapPortNodes(layout, model, renderers, theme, elkPortIds);
  alignFieldNotes(layout.nodes, model.notes || [], model.nodes, theme);
  positionTitle(layout, renderers);

  return { layout, renderers };
}



// ---------------------------------------------------------------------------
// Pass 1 helper — collect node center positions from ELK result
// ---------------------------------------------------------------------------

function collectNodePositions(
  node: any,
  parentX: number,
  parentY: number,
  positions: Map<string, { cx: number; cy: number }>,
): void {
  if (!node.children) return;
  for (const child of node.children) {
    const absX = parentX + (child.x ?? 0);
    const absY = parentY + (child.y ?? 0);
    const w = child.width ?? 0;
    const h = child.height ?? 0;
    positions.set(child.id, { cx: absX + w / 2, cy: absY + h / 2 });
    if (child.children) {
      collectNodePositions(child, absX, absY, positions);
    }
  }
}
