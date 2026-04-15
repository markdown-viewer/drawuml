/**
 * ELK layout engine — drives elkjs to produce node coordinates
 * and edge waypoints for DrawIO rendering.
 *
 * Counterpart of the DOT engine in dot-layout.ts.
 * Uses async API (elk.layout returns a Promise) for browser compatibility.
 */

import ELK from 'elkjs';
import type { LayoutResult } from '../../model/index.ts';
import type { SemanticModel, SemanticEdge, SemanticNode } from '../../model/index.ts';
import { Renderer } from '../../primitives/renderer.ts';
import { createRenderers, buildRendererTree } from '../renderer-tree.ts';
import { snapPortNodes, positionTitle, rearrangeSwimlanes, separateOverlappingEdges } from '../post-process.ts';
import { layoutGraphToElk, layoutGraphToElkSimple } from './elk-adapter.ts';
import { extractElkLayout } from './elk-extractor.ts';
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
 * swimlane / snap / positionTitle / separateOverlappingEdges
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
// Note rewrite — convert notes to regular nodes + edges for ELK
// ---------------------------------------------------------------------------

/**
 * Rewrite model.notes into model.nodes + model.edges so that ELK treats
 * notes as ordinary nodes.  This eliminates all note-specific code paths
 * in the ELK adapter and DrawIO generator (ELK branch).
 *
 * - Each note becomes a SemanticNode with stereotype 'note'.
 * - Each note-to-target connection becomes a dashed no-arrow SemanticEdge.
 * - Notes inherit group membership from their target node.
 * - onLink notes (edge labels) are also converted to standalone nodes.
 */
function rewriteNotesForElk(model: SemanticModel, theme?: Theme): void {
  if (!model.notes?.length) return;

  const th = theme ?? createTheme();

  // Build node→group map
  const nodeToGroup = new Map<string, string>();
  const groupIdSet = new Set<string>();
  for (const g of model.groups || []) {
    groupIdSet.add(g.id);
    for (const childId of g.children) nodeToGroup.set(childId, g.id);
  }

  for (const note of model.notes) {
    // Convert note to SemanticNode
    model.nodes.push({
      id: note.id,
      type: 'class',
      label: '',
      stereotype: 'note',
      // Extra fields for NoteNodeRenderer (spread into RenderDescriptor)
      lines: note.text.split('\n'),
      textHtml: note.textHtml,
      richBlocks: note.richBlocks,
      color: note.color,
    } as SemanticNode & { lines: string[]; textHtml?: string; richBlocks?: import('../model/normalized-rich-text.ts').NormalizedRichBlock[]; color?: string });

    if (note.target && !note.onLink) {
      // Add note to same group as its target (when target is a regular node)
      if (!groupIdSet.has(note.target)) {
        const groupId = nodeToGroup.get(note.target);
        if (groupId) {
          const group = (model.groups || []).find(g => g.id === groupId);
          if (group) {
            group.children.push(note.id);
            // For swimlane containers, concurrentRegions is a snapshot of lane
            // children taken at parse time.  Push the note into the same region
            // as its target so ELK can resolve the note_edge reference.
            if (group.type === 'swimlane_container' && group.concurrentRegions) {
              for (const region of group.concurrentRegions) {
                if (region.includes(note.target)) {
                  region.push(note.id);
                  break;
                }
              }
            }
          }
        }
      }

      // Note: memberTarget resolution to field ports is intentionally skipped.
      // The note edge connects to the node as a whole; directional placement
      // is handled by FIXED_SIDE ports in the ELK adapter.
      const toPort: string | undefined = undefined;

      // Create dashed no-arrow edge
      const noteEdge = {
        id: `__note_edge_${note.id}`,
        type: 'association',
        from: note.id,
        to: note.target,
        arrow: '..',
        arrowMeta: {
          token: '..',
          startHead: '',
          endHead: '',
          startHeadToken: '',
          endHeadToken: '',
          lineStyle: 'dashed',
          structured: true,
        },
        toPort,
        style: `#line:${th.noteLinkColor}`,
      } as SemanticEdge;
      // Store note position for ELK port constraint creation
      if (note.position) (noteEdge as any)._notePosition = note.position.toLowerCase();
      model.edges.push(noteEdge);
    }
  }

  model.notes = [];
}

// ---------------------------------------------------------------------------
// Public elkLayout — full pipeline including all post-processing
// ---------------------------------------------------------------------------

export async function elkLayout(model: SemanticModel, options?: { theme?: Theme }): Promise<ElkLayoutResult> {
  // Rewrite notes as regular nodes + edges so ELK treats them uniformly
  rewriteNotesForElk(model, options?.theme);

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
