/**
 * ELK adapter — converts LayoutGraphNode IR + SemanticModel into an ELK JSON graph.
 *
 * This is the ELK counterpart of dot-adapter.ts. It takes the same
 * LayoutGraphNode tree produced by buildLayoutGraph() and produces
 * an ELK-compatible JSON object that can be passed to elkjs.
 */

import type { LayoutGraphNode } from '../layout-graph.ts';
import type { SemanticModel, SemanticEdge, SemanticGroup } from '../../model/index.ts';
import { NodeType } from '../../model/index.ts';
import { Renderer } from '../../primitives/renderer.ts';
import { LabelRenderer } from '../../primitives/shapes/label.ts';

// ---------------------------------------------------------------------------
// ELK JSON type definitions (subset used by this adapter)
// ---------------------------------------------------------------------------

export interface ElkPort {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string | number>;
}

export interface ElkLabel {
  text: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  layoutOptions?: Record<string, string | number>;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
  layoutOptions?: Record<string, string | number>;
}

export interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  ports?: ElkPort[];
  labels?: ElkLabel[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Direction mapping
// ---------------------------------------------------------------------------

const RANKDIR_TO_ELK_DIRECTION: Record<string, string> = {
  TB: 'DOWN',
  BT: 'UP',
  LR: 'RIGHT',
  RL: 'LEFT',
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build a simplified ELK graph WITHOUT port constraints for pass 1.
 * Used to obtain node positions before deciding port sides.
 */
export function layoutGraphToElkSimple(
  root: LayoutGraphNode[],
  model: SemanticModel,
  renderers: Map<string, Renderer>,
): ElkNode {
  const rankdir = model.rankdir || 'TB';
  const elkDirection = RANKDIR_TO_ELK_DIRECTION[rankdir] || 'DOWN';

  // Collect edges — use node-level endpoints only (no ports)
  const allEdges = collectEdges(model, renderers);
  const simpleEdges: ElkEdge[] = allEdges.map(e => ({
    id: e.id,
    sources: [e.sources[0].includes('::') ? e.sources[0].split('::')[0] : e.sources[0]],
    targets: [e.targets[0].includes('::') ? e.targets[0].split('::')[0] : e.targets[0]],
    labels: e.labels,
  }));

  // Build group lookup map for concurrent region handling
  const groupMap = new Map<string, SemanticGroup>();
  for (const g of model.groups || []) groupMap.set(g.id, g);

  // Map nodes WITHOUT ports
  const children: ElkNode[] = root.map(n => mapNodeSimple(n, renderers, groupMap, elkDirection));

  // Add note/legend nodes
  for (const note of model.notes || []) {
    const r = renderers.get(note.id);
    if (!r) continue;
    const sz = r.measure();
    children.push({ id: note.id, width: sz.width, height: sz.height });
  }
  if (model.legend) {
    const legendR = renderers.get('__legend__');
    if (legendR) {
      const lsz = legendR.measure();
      children.push({ id: '__legend__', width: lsz.width, height: lsz.height });
    }
  }

  // Only use INCLUDE_CHILDREN when the model has groups (containers).
  // Without groups, omitting it lets ELK's component packer arrange
  // disconnected nodes in rows instead of a single long strip.
  const hasGroups = (model.groups || []).length > 0;

  const layoutOptions: Record<string, string | number> = {
    'elk.algorithm': 'layered',
    'elk.direction': elkDirection,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.spacing.nodeNode': '12',
    'elk.layered.spacing.nodeNodeBetweenLayers': '40',
    'elk.spacing.edgeNode': '10',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    // Post-layout compaction removes unnecessary vertical gaps
    'elk.layered.compaction.postCompaction.strategy': 'LEFT',
  };
  if (hasGroups) {
    layoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
  }

  const elkRoot: ElkNode = {
    id: 'root',
    layoutOptions,
    children,
    edges: [],
  };

  distributeEdges(elkRoot, simpleEdges);
  boostStartPathPriority(elkRoot, model);
  return elkRoot;
}

/**
 * Convert a LayoutGraphNode tree + SemanticModel into an ELK JSON graph.
 *
 * Edges are placed at their lowest common ancestor (LCA) container so that
 * intra-group edges are routed within the group rather than at the root level.
 * Cross-hierarchy edges are handled via `hierarchyHandling: INCLUDE_CHILDREN`.
 */
export function layoutGraphToElk(
  root: LayoutGraphNode[],
  model: SemanticModel,
  renderers: Map<string, Renderer>,
  nodePositions?: Map<string, { cx: number; cy: number }>,
): ElkNode {
  const rankdir = model.rankdir || 'TB';
  const elkDirection = RANKDIR_TO_ELK_DIRECTION[rankdir] || 'DOWN';

  // Collect all edges — both semantic edges and field-note edges
  const allEdges = collectEdges(model, renderers);

  // Build dual-port assignment: each used field port gets EAST+WEST variants
  // so edges can connect from either side, reducing routing congestion.
  // When nodePositions is available (pass 2), use position-aware assignment
  // to pick the nearest side for each edge.
  const { portVariants, edgePortMap } = buildPositionAwarePortAssignment(allEdges, nodePositions);

  // Apply port variant IDs to edge sources/targets
  for (const edge of allEdges) {
    const mapping = edgePortMap.get(edge.id);
    if (mapping) {
      edge.sources = mapping.sources;
      edge.targets = mapping.targets;
    }
  }

  // Build group lookup map for concurrent region handling
  const groupMap = new Map<string, SemanticGroup>();
  for (const g of model.groups || []) groupMap.set(g.id, g);

  // Map LayoutGraphNode tree to ELK children
  const children: ElkNode[] = root.map(n => mapNode(n, renderers, portVariants, groupMap, elkDirection));

  // Add note nodes (notes are not part of the LayoutGraphNode tree but may
  // be referenced by edges, e.g. "note ... as N2" with "Object .. N2")
  for (const note of model.notes || []) {
    const r = renderers.get(note.id);
    if (!r) continue;
    const sz = r.measure();
    children.push({ id: note.id, width: sz.width, height: sz.height });
  }

  // Add legend node
  if (model.legend) {
    const legendR = renderers.get('__legend__');
    if (legendR) {
      const lsz = legendR.measure();
      children.push({ id: '__legend__', width: lsz.width, height: lsz.height });
    }
  }

  // Only use INCLUDE_CHILDREN when the model has groups (containers).
  // Only use INCLUDE_CHILDREN when the model has groups (containers).
  // Without groups, omitting it lets ELK's component packer arrange
  // disconnected nodes in rows instead of a single long strip.
  const hasGroups = (model.groups || []).length > 0;

  const layoutOptions: Record<string, string | number> = {
    'elk.algorithm': 'layered',
    'elk.direction': elkDirection,
    'elk.edgeRouting': 'ORTHOGONAL',
    // Spacing — tighter than defaults to reduce unnecessary whitespace
    'elk.spacing.nodeNode': '12',
    'elk.layered.spacing.nodeNodeBetweenLayers': '40',
    'elk.spacing.edgeNode': '10',
    'elk.spacing.edgeEdge': '8',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
    // Keep edge channels centered between layers so bend points
    // don't hug the node boundary (avoids cramped arrow decorations).
    'elk.layered.spacing.edgeNodeBetweenLayers': '20',
    // Reduced edge-label spacing (default 5) to keep labeled edges compact
    'elk.spacing.edgeLabel': '2',
    // Post-layout compaction removes unnecessary vertical gaps
    'elk.layered.compaction.postCompaction.strategy': 'LEFT',
    // Node placement & alignment
    'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    'elk.contentAlignment': 'H_CENTER V_CENTER',
    // Preserve input ordering to reduce unnecessary crossings
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    // Special handling for nodes with many edges
    'elk.layered.highDegreeNodes.treatment': 'true',
    'elk.layered.highDegreeNodes.threshold': '8',
    // Do NOT merge parallel edges — each edge gets its own route
    // for better readability (merging causes overlapping lines).
    'elk.layered.mergeEdges': 'false',
  };
  if (hasGroups) {
    layoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
  }

  const elkRoot: ElkNode = {
    id: 'root',
    layoutOptions,
    children,
    edges: [],
  };

  // Place each edge at its lowest common ancestor container.
  // Build node-id → ancestor-path map, then distribute edges.
  distributeEdges(elkRoot, allEdges);

  // Boost direction priority on edges leaving the start node's target
  // so ELK's cycle breaker preserves the forward direction from the
  // start node outward.  Without this, when a cycle has more backward
  // edges than forward edges (e.g. A→B and B→A×2), the cycle breaker
  // reverses the start-initiated path, causing the start node to end
  // up in a middle layer instead of at the top.
  boostStartPathPriority(elkRoot, model);

  return elkRoot;
}

// ---------------------------------------------------------------------------
// Node mapping
// ---------------------------------------------------------------------------

/**
 * Recursively map a LayoutGraphNode to an ElkNode.
 */
function mapNode(
  gn: LayoutGraphNode,
  renderers: Map<string, Renderer>,
  portVariants: Map<string, Array<{ variantId: string; side: string }>>,
  groupMap: Map<string, SemanticGroup>,
  elkDirection: string,
): ElkNode {
  const elk: ElkNode = {
    id: gn.id,
    width: gn.width,
    height: gn.height,
  };

  // Container node — has children
  if (gn.children && gn.children.length > 0) {
    const group = groupMap.get(gn.id);

    if (group?.concurrentRegions && group.concurrentRegions.length > 1) {
      if (group.type === 'swimlane_container') {
        // ── Activity swimlanes — flatten for global layer ordering ──
        // ELK cannot do cross-region layering with perpendicular direction,
        // so we flatten all region children into this container and let
        // ELK compute correct top-to-bottom ordering. Post-processing
        // (rearrangeSwimlanes with engine='elk') will assign X columns.
        const flatChildren: ElkNode[] = [];
        for (const regionNode of gn.children) {
          if (regionNode.children) {
            for (const leaf of regionNode.children) {
              flatChildren.push(mapNode(leaf, renderers, portVariants, groupMap, elkDirection));
            }
          }
        }
        elk.children = flatChildren;
        elk.layoutOptions = {
          'elk.padding': '[top=0,left=0,bottom=0,right=0]',
          'elk.spacing.nodeNode': '12',
          'elk.layered.spacing.nodeNodeBetweenLayers': '40',
          'elk.spacing.edgeNode': '10',
          'elk.spacing.edgeEdge': '8',
          'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
          'elk.layered.spacing.edgeNodeBetweenLayers': '20',
        };
      } else {
        // ── State concurrent regions — perpendicular direction ──
        const perpDir = (elkDirection === 'DOWN' || elkDirection === 'UP') ? 'RIGHT' : 'DOWN';
        elk.children = gn.children.map(c => mapNode(c, renderers, portVariants, groupMap, elkDirection));
        elk.layoutOptions = {
          'elk.direction': perpDir,
          'elk.spacing.nodeNode': '0',
          'elk.layered.spacing.nodeNodeBetweenLayers': '0',
          'elk.padding': '[top=26,left=0,bottom=0,right=0]',
        };
      }
    } else {
      // ── Normal container ───────────────────────────────────────────
      elk.children = gn.children.map(c => mapNode(c, renderers, portVariants, groupMap, elkDirection));

      // Container padding + spacing.
      if (gn.padding) {
        const p = gn.padding;
        elk.layoutOptions = {
          'elk.padding': `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`,
          'elk.spacing.nodeNode': '12',
          'elk.layered.spacing.nodeNodeBetweenLayers': '40',
          'elk.spacing.edgeNode': '10',
          'elk.spacing.edgeEdge': '8',
          'elk.layered.spacing.edgeEdgeBetweenLayers': '8',
          'elk.layered.spacing.edgeNodeBetweenLayers': '20',
        };
      }
    }

    // For containers, width/height are computed by ELK — don't fix them
    delete elk.width;
    delete elk.height;
  }

  // For leaf nodes with graphicCenterOffset (icon above/beside title),
  // shrink ELK node to icon-only dimensions and add the title area
  // as an external label with actual text.  ELK routes edges to the
  // icon center and auto-computes margin for the label via
  // NodeMarginCalculator.
  if (!gn.children?.length) {
    const r = renderers.get(gn.id);
    if (r) {
      const off = r.graphicCenterOffset();
      const label = r.nodeLabel;
      if (off.dy !== 0 && label) {
        const iconH = (gn.height ?? 0) + 2 * off.dy;
        if (iconH > 0) {
          const labelH = (gn.height ?? 0) - iconH;
          elk.height = iconH;
          if (!elk.labels) elk.labels = [];
          elk.labels.push({
            text: label,
            width: gn.width ?? 0,
            height: labelH,
            layoutOptions: {
              'elk.nodeLabels.placement': off.dy < 0
                ? 'OUTSIDE V_BOTTOM H_CENTER'
                : 'OUTSIDE V_TOP H_CENTER',
            },
          });
        }
      }
      if (off.dx !== 0 && label) {
        const iconW = (gn.width ?? 0) + 2 * off.dx;
        if (iconW > 0) {
          const labelW = (gn.width ?? 0) - iconW;
          elk.width = iconW;
          if (!elk.labels) elk.labels = [];
          elk.labels.push({
            text: label,
            width: labelW,
            height: gn.height ?? 0,
            layoutOptions: {
              'elk.nodeLabels.placement': off.dx < 0
                ? 'OUTSIDE H_RIGHT V_CENTER'
                : 'OUTSIDE H_LEFT V_CENTER',
            },
          });
        }
      }
    }
  }

  // Ports (for field-level edge routing)
  // Only include ports that are actually referenced by edges (present in
  // portVariants).  Nodes may declare ports for fields that no edge connects
  // to — adding those unused ports would force ELK to route node-level
  // edges to the port side instead of the node center.
  //
  // Each used port may have EAST and/or WEST variants (dual-port) so
  // edges can connect from either side, reducing routing congestion.
  if (gn.ports && gn.ports.length > 0) {
    const nodeWidth = gn.width ?? 0;
    const usedPorts = gn.ports.filter(p => portVariants.has(p.id));
    if (usedPorts.length > 0) {
      const elkPorts: ElkPort[] = [];
      for (const p of usedPorts) {
        const variants = portVariants.get(p.id)!;
        const portY = (p.y ?? 0) + (p.height ?? 0) / 2;
        for (const v of variants) {
          elkPorts.push({
            id: v.variantId,
            x: v.side === 'EAST' ? nodeWidth : 0,
            y: portY,
            width: 1,
            height: 1,
            layoutOptions: {
              'elk.port.side': v.side,
            },
          });
        }
      }
      elk.ports = elkPorts;
      if (!elk.layoutOptions) elk.layoutOptions = {};
      elk.layoutOptions['elk.portConstraints'] = 'FIXED_POS';
    }
  }

  // External labels (xlabel equivalent) — append to any existing labels
  if (gn.labels && gn.labels.length > 0) {
    const xlabels = gn.labels.map(l => ({
      text: l.text,
      width: l.width,
      height: l.height,
      layoutOptions: {
        'elk.nodeLabels.placement': l.placement || 'OUTSIDE V_BOTTOM H_CENTER',
      },
    }));
    elk.labels = (elk.labels || []).concat(xlabels);
  }

  return elk;
}

// ---------------------------------------------------------------------------
// Edge distribution — place edges at their lowest common ancestor (LCA)
// ---------------------------------------------------------------------------

/**
 * Build a map from node/port ID → list of ancestor container IDs (from root
 * down to the immediate parent).  Port IDs like "A::field" are mapped via
 * their owner node "A".
 */
function buildAncestorMap(elkRoot: ElkNode): Map<string, string[]> {
  const map = new Map<string, string[]>();

  function walk(node: ElkNode, ancestors: string[]) {
    // Register this node (leaf or container)
    map.set(node.id, ancestors);

    if (node.children) {
      const childAncestors = [...ancestors, node.id];
      for (const child of node.children) {
        walk(child, childAncestors);
      }
    }
  }

  // Walk from root — root itself is the top-level ancestor
  if (elkRoot.children) {
    for (const child of elkRoot.children) {
      walk(child, [elkRoot.id]);
    }
  }

  return map;
}

/**
 * Find the LCA container ID for two node IDs.
 * Returns the deepest common ancestor from the ancestor paths.
 */
function findLCA(ancestorMap: Map<string, string[]>, idA: string, idB: string): string {
  const pathA = ancestorMap.get(idA);
  const pathB = ancestorMap.get(idB);
  if (!pathA || !pathB) return 'root';

  // Walk both paths in lockstep; the last matching element is the LCA
  let lca = 'root';
  const minLen = Math.min(pathA.length, pathB.length);
  for (let i = 0; i < minLen; i++) {
    if (pathA[i] === pathB[i]) lca = pathA[i];
    else break;
  }

  return lca;
}

/**
 * Build a map from container ID → ElkNode for quick lookup.
 */
function buildNodeMap(elkRoot: ElkNode): Map<string, ElkNode> {
  const map = new Map<string, ElkNode>();

  function walk(node: ElkNode) {
    map.set(node.id, node);
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }

  walk(elkRoot);
  return map;
}

/**
 * Distribute edges to their LCA containers so that intra-group edges
 * are routed within the group instead of at the root level.
 */
function distributeEdges(elkRoot: ElkNode, edges: ElkEdge[]): void {
  const ancestorMap = buildAncestorMap(elkRoot);
  const nodeMap = buildNodeMap(elkRoot);

  for (const edge of edges) {
    // Extract base node IDs (strip port suffix "node::port" → "node")
    const srcId = edge.sources[0];
    const tgtId = edge.targets[0];
    const srcNode = srcId.includes('::') ? srcId.split('::')[0] : srcId;
    const tgtNode = tgtId.includes('::') ? tgtId.split('::')[0] : tgtId;

    const lcaId = findLCA(ancestorMap, srcNode, tgtNode);
    const lcaNode = nodeMap.get(lcaId);

    if (lcaNode) {
      if (!lcaNode.edges) lcaNode.edges = [];
      lcaNode.edges.push(edge);
    }
  }
}

/**
 * For containers that own a __state_start__ child, boost the direction
 * priority of outgoing edges from the start node's target.  This ensures
 * ELK's cycle breaker preserves the forward path originating at the start
 * node, preventing the start from being placed in a middle layer.
 */
function boostStartPathPriority(elkRoot: ElkNode, model: SemanticModel): void {
  // Build node type lookup from semantic model
  const nodeTypeMap = new Map<string, string>();
  for (const n of model.nodes) nodeTypeMap.set(n.id, n.type);

  (function walk(node: ElkNode) {
    if (node.children) {
      // Set layerConstraint on start/end nodes
      for (const child of node.children) {
        const ntype = nodeTypeMap.get(child.id);
        if (ntype === NodeType.StateStart) {
          if (!child.layoutOptions) child.layoutOptions = {};
          child.layoutOptions['elk.layered.layerConstraint'] = 'FIRST';
        } else if (ntype === NodeType.StateEnd) {
          if (!child.layoutOptions) child.layoutOptions = {};
          child.layoutOptions['elk.layered.layerConstraint'] = 'LAST';
        }
      }

      // Also boost edge priority from start's direct targets
      if (node.edges) {
        const startIds = new Set<string>();
        for (const child of node.children) {
          if (nodeTypeMap.get(child.id) === NodeType.StateStart) startIds.add(child.id);
        }

        if (startIds.size > 0) {
          const startTargets = new Set<string>();
          for (const edge of node.edges) {
            const src = edge.sources[0];
            const srcNode = src.includes('::') ? src.split('::')[0] : src;
            if (startIds.has(srcNode)) {
              const tgt = edge.targets[0];
              const tgtNode = tgt.includes('::') ? tgt.split('::')[0] : tgt;
              startTargets.add(tgtNode);
            }
          }

          if (startTargets.size > 0) {
            for (const edge of node.edges) {
              const src = edge.sources[0];
              const srcNode = src.includes('::') ? src.split('::')[0] : src;
              if (startTargets.has(srcNode)) {
                if (!edge.layoutOptions) edge.layoutOptions = {};
                edge.layoutOptions['elk.layered.priority.direction'] = '1000';
              }
            }
          }
        }
      }

      // Recurse into child containers
      for (const child of node.children) walk(child);
    }
  })(elkRoot);
}

// ---------------------------------------------------------------------------
// Edge collection
// ---------------------------------------------------------------------------

/**
 * Collect all edges from the SemanticModel, mapping them to ELK edge format.
 *
 * Handles:
 * - Regular node-to-node edges
 * - Port-level edges (fromPort / toPort)
 * - Direction-inverted edges (left/up → swap source/target for layout)
 */
function collectEdges(
  model: SemanticModel,
  renderers: Map<string, Renderer>,
): ElkEdge[] {
  const elkEdges: ElkEdge[] = [];

  for (const edge of model.edges) {
    const isInverted = edge.direction === 'left' || edge.direction === 'up';
    const from = isInverted ? edge.to : edge.from;
    const to = isInverted ? edge.from : edge.to;

    // Source/target — use port IDs if present
    const fromPort = isInverted ? edge.toPort : edge.fromPort;
    const toPort = isInverted ? edge.fromPort : edge.toPort;

    const source = fromPort ? `${from}::${fromPort}` : from;
    const target = toPort ? `${to}::${toPort}` : to;

    const elkEdge: ElkEdge = {
      id: edge.id,
      sources: [source],
      targets: [target],
    };

    // Edge label — use LabelRenderer for proper multi-line measurement
    if (edge.label) {
      const lr = new LabelRenderer({ id: edge.id + '__label', label: edge.label });
      const m = lr.measure();
      elkEdge.labels = [{
        text: edge.label,
        width: m.width,
        height: m.height,
      }];
    }

    elkEdges.push(elkEdge);
  }

  return elkEdges;
}

// ---------------------------------------------------------------------------
// Simple node mapping (pass 1 — no ports)
// ---------------------------------------------------------------------------

function mapNodeSimple(gn: LayoutGraphNode, renderers: Map<string, Renderer>, groupMap: Map<string, SemanticGroup>, elkDirection: string): ElkNode {
  const elk: ElkNode = { id: gn.id, width: gn.width, height: gn.height };

  if (gn.children && gn.children.length > 0) {
    const group = groupMap.get(gn.id);

    if (group?.concurrentRegions && group.concurrentRegions.length > 1) {
      if (group.type === 'swimlane_container') {
        // ── Activity swimlanes — flatten (same as mapNode) ──
        const flatChildren: ElkNode[] = [];
        for (const regionNode of gn.children) {
          if (regionNode.children) {
            for (const leaf of regionNode.children) {
              flatChildren.push(mapNodeSimple(leaf, renderers, groupMap, elkDirection));
            }
          }
        }
        elk.children = flatChildren;
        elk.layoutOptions = {
          'elk.padding': '[top=0,left=0,bottom=0,right=0]',
        };
      } else {
        // ── State concurrent regions — perpendicular direction ──
        const perpDir = (elkDirection === 'DOWN' || elkDirection === 'UP') ? 'RIGHT' : 'DOWN';
        elk.children = gn.children.map(c => mapNodeSimple(c, renderers, groupMap, elkDirection));
        elk.layoutOptions = {
          'elk.direction': perpDir,
          'elk.spacing.nodeNode': '0',
          'elk.layered.spacing.nodeNodeBetweenLayers': '0',
          'elk.padding': '[top=26,left=0,bottom=0,right=0]',
        };
      }
    } else {
      // ── Normal container ──
      elk.children = gn.children.map(c => mapNodeSimple(c, renderers, groupMap, elkDirection));
      if (gn.padding) {
        const p = gn.padding;
        elk.layoutOptions = {
          'elk.padding': `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`,
        };
      }
    }

    delete elk.width;
    delete elk.height;
  }

  // Shrink nodes with graphicCenterOffset to icon-only dimensions (same as mapNode)
  if (!gn.children?.length) {
    const r = renderers.get(gn.id);
    if (r) {
      const off = r.graphicCenterOffset();
      const label = r.nodeLabel;
      if (off.dy !== 0 && label) {
        const iconH = gn.height + 2 * off.dy;
        if (iconH > 0) {
          elk.height = iconH;
          if (!elk.labels) elk.labels = [];
          elk.labels.push({
            text: label, width: gn.width, height: gn.height - iconH,
            layoutOptions: {
              'elk.nodeLabels.placement': off.dy < 0
                ? 'OUTSIDE V_BOTTOM H_CENTER' : 'OUTSIDE V_TOP H_CENTER',
            },
          });
        }
      }
      if (off.dx !== 0 && label) {
        const iconW = gn.width + 2 * off.dx;
        if (iconW > 0) {
          elk.width = iconW;
          if (!elk.labels) elk.labels = [];
          elk.labels.push({
            text: label, width: gn.width - iconW, height: gn.height,
            layoutOptions: {
              'elk.nodeLabels.placement': off.dx < 0
                ? 'OUTSIDE H_RIGHT V_CENTER' : 'OUTSIDE H_LEFT V_CENTER',
            },
          });
        }
      }
    }
  }

  // External labels — append to any existing labels
  if (gn.labels && gn.labels.length > 0) {
    const xlabels = gn.labels.map(l => ({
      text: l.text, width: l.width, height: l.height,
      layoutOptions: { 'elk.nodeLabels.placement': l.placement || 'OUTSIDE V_BOTTOM H_CENTER' },
    }));
    elk.labels = (elk.labels || []).concat(xlabels);
  }
  return elk;
}

// ---------------------------------------------------------------------------
// Port side mapping — position-aware
// ---------------------------------------------------------------------------

/**
 * Build port assignment using node positions from pass 1.
 *
 * For each port-level edge, determine which side (EAST/WEST) the port
 * should connect from based on the relative horizontal position of the
 * connected node vs the port's owner node.
 *
 * To prevent ELK from merging edges that share the same port (hyperedge
 * merging), each edge gets its own dedicated port instance.  This keeps
 * edges parallel instead of merging into a shared path.
 *
 * - If the other node is to the RIGHT → use EAST port
 * - If the other node is to the LEFT  → use WEST port
 * - Fallback (no positions): source→EAST, target→WEST
 */
function buildPositionAwarePortAssignment(
  edges: ElkEdge[],
  nodePositions?: Map<string, { cx: number; cy: number }>,
): {
  portVariants: Map<string, Array<{ variantId: string; side: string }>>;
  edgePortMap: Map<string, { sources: string[]; targets: string[] }>;
} {
  // Step 1: For each edge, determine the desired side for its port endpoints
  // and create a unique port variant per edge to avoid hyperedge merging
  const portVariants = new Map<string, Array<{ variantId: string; side: string }>>();
  const edgePortMap = new Map<string, { sources: string[]; targets: string[] }>();

  for (const edge of edges) {
    const srcFull = edge.sources[0];
    const tgtFull = edge.targets[0];
    const srcIsPort = srcFull.includes('::');
    const tgtIsPort = tgtFull.includes('::');

    const sources: string[] = [];
    const targets: string[] = [];

    if (!srcIsPort && !tgtIsPort) {
      edgePortMap.set(edge.id, { sources: [srcFull], targets: [tgtFull] });
      continue;
    }

    const srcNode = srcIsPort ? srcFull.split('::')[0] : srcFull;
    const tgtNode = tgtIsPort ? tgtFull.split('::')[0] : tgtFull;

    let srcSide = 'EAST';
    let tgtSide = 'WEST';

    if (nodePositions) {
      const srcPos = nodePositions.get(srcNode);
      const tgtPos = nodePositions.get(tgtNode);
      if (srcPos && tgtPos) {
        srcSide = tgtPos.cx >= srcPos.cx ? 'EAST' : 'WEST';
        tgtSide = srcPos.cx >= tgtPos.cx ? 'EAST' : 'WEST';
      }
    }

    // Create per-edge port variant for source
    if (srcIsPort) {
      const suffix = srcSide === 'EAST' ? 'E' : 'W';
      const variantId = `${srcFull}__${suffix}_${edge.id}`;
      sources.push(variantId);
      if (!portVariants.has(srcFull)) portVariants.set(srcFull, []);
      portVariants.get(srcFull)!.push({ variantId, side: srcSide });
    } else {
      sources.push(srcFull);
    }

    // Create per-edge port variant for target
    if (tgtIsPort) {
      const suffix = tgtSide === 'EAST' ? 'E' : 'W';
      const variantId = `${tgtFull}__${suffix}_${edge.id}`;
      targets.push(variantId);
      if (!portVariants.has(tgtFull)) portVariants.set(tgtFull, []);
      portVariants.get(tgtFull)!.push({ variantId, side: tgtSide });
    } else {
      targets.push(tgtFull);
    }

    edgePortMap.set(edge.id, { sources, targets });
  }

  return { portVariants, edgePortMap };
}