/**
 * Renderer tree construction — engine-agnostic helpers for creating
 * renderers and wiring the parent–child hierarchy from a SemanticModel.
 *
 * Extracted from dot-layout.ts so that any layout engine (DOT, ELK, …)
 * can reuse the same renderer setup.
 */

import type { SemanticModel } from '../model/index.ts';
import { createNodeRenderer, createGlobalRenderers, createRenderer } from '../primitives/index.ts';
import type { NodeDescriptor } from '../primitives/registry.ts';
import { resolveGroupShape } from '../primitives/group.ts';
import { Renderer } from '../primitives/renderer.ts';
import { ConcurrentRegionRenderer } from '../primitives/state-node.ts';
import type { Theme } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Renderer creation
// ---------------------------------------------------------------------------

/**
 * Create renderers for every node, note, and global element in the model.
 *
 * Skinparam-derived flags (visibility icons, activity shape, actor style,
 * component style) are applied here so callers don't repeat the logic.
 */
export function createRenderers(model: SemanticModel, options?: { theme?: Theme }): Map<string, Renderer> {
  const theme = options?.theme;
  const visIcons = !(model.skinparams && model.skinparams.classAttributeIconSize === '0');
  const activityShape = model.skinparams?.activityShape;
  const actorStyle = model.skinparams?.actorStyle;
  const componentStyle = model.skinparams?.componentStyle;

  const renderers = new Map<string, Renderer>();

  for (const node of model.nodes) {
    const desc: NodeDescriptor = { ...node, theme };
    if (!visIcons) desc.visibilityIcons = false;
    if (activityShape) desc.activityShape = activityShape;
    if (actorStyle) desc.actorStyle = actorStyle;
    // skinparam componentStyle rectangle: render components as plain rectangles
    if (componentStyle === 'rectangle' && (desc.stereotype === 'component' || desc.stereotype === 'component1' || desc.stereotype === 'component2')) {
      desc.stereotype = 'rectangle';
    }
    renderers.set(node.id, createNodeRenderer(desc));
  }

  for (const note of model.notes || []) {
    renderers.set(note.id, createRenderer('note', { id: note.id, lines: note.text.split('\n'), color: note.color, theme }));
  }

  // Global renderers (title, legend) via factory
  createGlobalRenderers(model, { theme }).forEach((r, id) => renderers.set(id, r));

  return renderers;
}

// ---------------------------------------------------------------------------
// Renderer tree wiring
// ---------------------------------------------------------------------------

/**
 * Build renderer tree: create GroupRenderers, wire child renderers,
 * and return ordered root renderer list for DOT/ELK generation.
 */
export function buildRendererTree(
  model: SemanticModel,
  renderers: Map<string, Renderer>,
  options?: { theme?: Theme },
): Renderer[] {
  const theme = options?.theme;
  const groups = model.groups || [];
  if (groups.length === 0) {
    // No groups — all node renderers are roots (preserving document order)
    return model.nodes.map(n => renderers.get(n.id)).filter(Boolean) as Renderer[];
  }

  // Create or configure container renderers for each group.
  // State-type groups reuse the existing StateNodeRenderer (which adapts
  // its behaviour based on whether children are wired to it).
  // Non-state groups create a per-shape renderer via the node registry.
  const globalPkgStyle = model.skinparams?.packageStyle;
  const groupRenderers = new Map<string, Renderer>();
  for (const g of groups) {
    if (g.type === 'state') {
      // Reuse the StateNodeRenderer already created for this node
      const existing = renderers.get(g.id);
      if (existing) {
        groupRenderers.set(g.id, existing);
      }
    } else {
      const shape = resolveGroupShape(g.type, g.stereotype, globalPkgStyle, g.id);
      const gr = createNodeRenderer({ id: g.id, label: g.label, stereotype: shape, color: g.color, style: g.style, theme });
      groupRenderers.set(g.id, gr);
      renderers.set(g.id, gr);
    }
  }

  // Wire child renderers to container renderers (unified — no children/childGroups split)
  const nodeGroupMap = new Map<string, string>();
  for (const g of groups) {
    const gr = groupRenderers.get(g.id);
    if (!gr) continue;

    // Concurrent regions: create intermediate region renderers.
    // Children are wired to their region renderer instead of directly to the group.
    if (g.concurrentRegions && g.concurrentRegions.length > 1) {
      for (let i = 0; i < g.concurrentRegions.length; i++) {
        const regionId = `${g.id}.__conc_region__${i}`;
        const regionLabel = g.concurrentRegionLabels?.[i] || '';
        const regionColor = g.concurrentRegionColors?.[i] || '';
        const regionR = new ConcurrentRegionRenderer(regionId, regionLabel, regionColor, theme);
        renderers.set(regionId, regionR);
        gr.addChild(regionR);
        for (const childId of g.concurrentRegions[i]) {
          nodeGroupMap.set(childId, regionId);
          const r = renderers.get(childId);
          if (r) regionR.addChild(r);
        }
      }
      // Wire childGroups as before (they don't belong to concurrent regions)
      for (const cgId of g.childGroups) {
        const cgr = groupRenderers.get(cgId);
        if (cgr && cgr.isCluster) {
          gr.addChild(cgr);
        } else {
          const r = renderers.get(cgId);
          if (r) {
            gr.addChild(r);
            nodeGroupMap.set(cgId, g.id);
          }
        }
      }
      continue;
    }

    for (const childId of g.children) {
      nodeGroupMap.set(childId, g.id);
      const r = renderers.get(childId);
      if (r) gr.addChild(r);
    }
    for (const cgId of g.childGroups) {
      const cgr = groupRenderers.get(cgId);
      if (cgr && cgr.isCluster) {
        // Non-empty container → add as nested cluster child
        gr.addChild(cgr);
      } else {
        // Empty state (leaf) → treat as regular child node
        const r = renderers.get(cgId);
        if (r) {
          gr.addChild(r);
          nodeGroupMap.set(cgId, g.id);
        }
      }
    }
  }

  // Build root renderer list: top-level nodes first, then top-level groups
  // (preserves current DOT output order for layout stability)
  const rootRenderers: Renderer[] = [];
  for (const node of model.nodes) {
    // Skip nodes managed by a container renderer
    if (groupRenderers.has(node.id)) continue;
    if (nodeGroupMap.has(node.id)) continue;
    const r = renderers.get(node.id);
    if (r) rootRenderers.push(r);
  }
  for (const g of groups) {
    if (!g.parentId) {
      const gr = groupRenderers.get(g.id);
      if (gr) rootRenderers.push(gr);
    }
  }
  return rootRenderers;
}
