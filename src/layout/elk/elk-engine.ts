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
import { elkSwimlaneLayout2 } from './elk-swimlane2.ts';

// ---------------------------------------------------------------------------
// ELK instance management
// ---------------------------------------------------------------------------

let elkInstance: any = null;

export function getElk() {
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
 * Core ELK layout pipeline (steps 1–8, no post-processing).
 *
 * Runs the full two-pass ELK layout including:
 *  - renderer tree construction
 *  - pass-1 (no-port) ELK call to get node positions
 *  - pass-2 (port-aware) ELK call for final coordinates and edge routing
 *  - label position extraction
 *
 * Returns the raw LayoutResult + pre-built renderers, without any of the
 * swimlane / snap / alignFieldNotes / positionTitle / separateOverlappingEdges
 * post-processing so callers can apply only what they need.
 */
export async function runElkPipeline(
  model: SemanticModel,
  options?: { theme?: Theme },
): Promise<ElkLayoutResult> {
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
    for (const g of model.groups) groupIds.add(g.id);
  }

  // 7. Run ELK layout pass 2
  const elkResult = await elk.layout(elkGraph);

  // 8. Extract layout result (includes label positions from ELK)
  const layout = extractElkLayout(elkResult, model.edges, renderers, groupIds);

  return { layout, renderers };
}

// ---------------------------------------------------------------------------
// Public elkLayout — full pipeline including all post-processing
// ---------------------------------------------------------------------------

export async function elkLayout(model: SemanticModel, options?: { theme?: Theme }): Promise<ElkLayoutResult> {
  // Swimlane diagrams: border-port alignment algorithm, then shared post-processing
  const hasSwimlanes = (model.groups || []).some(
    g => g.type === 'swimlane_container' && g.concurrentRegions && g.concurrentRegions.length > 1,
  );

  const { layout, renderers } = hasSwimlanes
    ? await elkSwimlaneLayout2(model, options)
    : await runElkPipeline(model, options);

  const theme = options?.theme ?? createTheme();

  // Swimlane column rearrangement (non-swimlane path only; swimlane already handled internally)
  if (!hasSwimlanes) rearrangeSwimlanes(layout, model, theme);

  // Post-processing shared by both paths
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
  separateOverlappingEdges(layout, theme.edgeGap);

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
