/**
 * Adapter: ELK orthogonal routing on top of DOT node positions.
 *
 * DOT gives us node positions (x, y, width, height) and coarse edge routes.
 * We reconstruct layers from node positions, create HyperEdgeSegments for
 * each adjacent layer pair, run the ELK routing algorithm, then write back
 * orthogonal bend points to LayoutEdge.points.
 *
 * Long edges (spanning > 1 layer gap) are split into per-gap segments that
 * each participate in their respective layer-pair routing — equivalent to
 * ELK's LongEdgeSplitter inserting dummy nodes.
 *
 * Translated from ELK NorthToSouthRoutingStrategy / WestToEastRoutingStrategy
 * calculateBendPoints logic.
 */
import type { LayoutResult, LayoutNode, LayoutEdge, LayoutGroup } from '../model/index.ts';
import type { SemanticModel } from '../model/index.ts';
import type { Theme } from '../shared/theme.ts';
import { HyperEdgeSegment, insertSorted } from './orthogonal/hyper-edge-segment.ts';
import { routeEdgesBetweenLayers, TOLERANCE } from './orthogonal/orthogonal-routing-generator.ts';
import { LabelRenderer } from '../primitives/shapes/label.ts';

/** Spacing parameters for orthogonal routing. */
interface RoutingSpacing {
  /** Edge-to-edge spacing (routing slot pitch). */
  edgeEdge: number;
  /** Edge-to-node spacing (minimum distance from edge turn to node border). */
  edgeNode: number;
  /** Additional node-to-node spacing per pass-through edge. */
  nodeNode: number;
  /** Spacing between edge trunk and its label (matches ELK elk.spacing.edgeLabel). */
  edgeLabelSpacing: number;
}

function spacingFromTheme(theme: Theme): RoutingSpacing {
  return {
    edgeEdge: theme.padXS,
    edgeNode: theme.padL,
    nodeNode: theme.padL,
    edgeLabelSpacing: theme.padXS,
  };
}

// ---------------------------------------------------------------------------
// Public API — called from dot-layout.ts
// ---------------------------------------------------------------------------

export function routeOrthogonal(layout: LayoutResult, model: SemanticModel, theme: Theme): void {
  const sp = spacingFromTheme(theme);
  const isLR = model.rankdir === 'LR';

  // Pre-compute label sizes for edges that have center labels
  if (layout.edges) {
    const edgeById = new Map<string, typeof model.edges[0]>();
    for (const se of model.edges) edgeById.set(se.id, se);
    for (const le of layout.edges) {
      if (le.labelPos && !le.labelSize) {
        const se = edgeById.get(le.id);
        if (se?.label) {
          const lr = new LabelRenderer({ id: le.id + '__label', label: se.label, theme });
          le.labelSize = lr.measure();
        }
      }
    }
  }

  routeAllEdges(layout, sp, isLR);
}

// ---------------------------------------------------------------------------
// Unified routing for TB and LR
// ---------------------------------------------------------------------------

/**
 * Information about one edge segment within a single layer gap.
 * Long edges produce multiple GapSegments (one per gap they traverse).
 */
interface GapSegment {
  edgeId: string;
  /** X (TB) or Y (LR) coordinate of the source-side connection */
  sourcePos: number;
  /** X (TB) or Y (LR) coordinate of the target-side connection */
  targetPos: number;
  /** Index of this gap in the edge's path (0 = first gap from source) */
  gapIndex: number;
  /** Total number of gaps this edge spans */
  totalGaps: number;
  /** The HyperEdgeSegment assigned after creation */
  segment?: HyperEdgeSegment;
}

/**
 * Result of routing a single gap segment: the computed horizontal (TB) or
 * vertical (LR) position for this segment's trunk.
 */
interface GapSegmentResult {
  edgeId: string;
  gapIndex: number;
  totalGaps: number;
  sourcePos: number;
  targetPos: number;
  /** Position of the trunk (Y for TB, X for LR) */
  trunkPos: number;
  /** Split partner trunk position, if segment was split */
  splitTrunkPos?: number;
  /** Split link coordinate (on the port axis) */
  splitLinkPos?: number;
}

function routeAllEdges(layout: LayoutResult, sp: RoutingSpacing, isLR: boolean): void {
  const nodes = layout.nodes;
  const edges = layout.edges;
  if (!edges || edges.length === 0) return;

  const layers = buildLayers(nodes, isLR);
  if (layers.length < 2) return;

  // nodeId -> layerIndex
  const nodeLayerIndex = new Map<string, number>();
  for (let li = 0; li < layers.length; li++) {
    for (const nid of layers[li]) {
      nodeLayerIndex.set(nid, li);
    }
  }

  // Preprocess: adjust node spacing for layers with pass-through long edges
  adjustNodeSpacing(nodes, edges, layers, nodeLayerIndex, sp, isLR, layout.groups);

  // Pre-compute pass-through positions for long edges (needed for port ordering)
  const edgePassThrough = new Map<string, number>();
  for (const edge of edges) {
    const srcNode = nodes[edge.from];
    const tgtNode = nodes[edge.to];
    if (!srcNode || !tgtNode) continue;

    let srcLayer = nodeLayerIndex.get(edge.from);
    let tgtLayer = nodeLayerIndex.get(edge.to);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer > tgtLayer) { const tmp = srcLayer; srcLayer = tgtLayer; tgtLayer = tmp; }
    if (tgtLayer - srcLayer <= 1) continue;

    // Use node centers as initial port estimate for pass-through calculation
    const srcN = nodes[edge.from];
    const tgtN = nodes[edge.to];
    const srcCenter = isLR ? srcN.y + srcN.height / 2 : srcN.x + srcN.width / 2;
    const tgtCenter = isLR ? tgtN.y + tgtN.height / 2 : tgtN.x + tgtN.width / 2;
    const passThrough = findPassThroughPos(
      nodes, layers, srcLayer, tgtLayer, srcCenter, tgtCenter, isLR, sp.edgeNode
    );
    edgePassThrough.set(edge.id, passThrough);
  }

  // Compute port positions — distribute multiple edges evenly across each node side
  const portAssignments = assignPorts(nodes, edges, nodeLayerIndex, isLR, edgePassThrough);

  // Compute gap boundaries: for each gap i, the start position for routing slots
  const gapStartPos: number[] = [];
  for (let li = 0; li < layers.length - 1; li++) {
    let maxEnd = -Infinity;
    let minStart = Infinity;
    for (const nid of layers[li]) {
      const n = nodes[nid];
      if (n) maxEnd = Math.max(maxEnd, isLR ? n.x + n.width : n.y + n.height);
    }
    for (const nid of layers[li + 1]) {
      const n = nodes[nid];
      if (n) minStart = Math.min(minStart, isLR ? n.x : n.y);
    }
    gapStartPos.push(maxEnd + sp.edgeNode);
  }

  // Decompose all edges into per-gap segments
  // gapSegments[gapIndex] = list of GapSegments for that gap
  const gapSegments: GapSegment[][] = [];
  for (let i = 0; i < layers.length - 1; i++) gapSegments.push([]);

  // Collect long edge pass-through allocations for collinear separation
  const longEdgeAllocations: LongEdgeAllocation[] = [];

  for (const edge of edges) {
    const srcNode = nodes[edge.from];
    const tgtNode = nodes[edge.to];
    if (!srcNode || !tgtNode) continue;

    let srcLayer = nodeLayerIndex.get(edge.from);
    let tgtLayer = nodeLayerIndex.get(edge.to);
    if (srcLayer === undefined || tgtLayer === undefined) continue;

    // Ensure forward direction (lower layer -> higher layer)
    const isForward = srcLayer <= tgtLayer;
    if (!isForward) {
      const tmp = srcLayer; srcLayer = tgtLayer; tgtLayer = tmp;
    }

    // Same layer — keep existing DOT points
    if (srcLayer === tgtLayer) continue;

    const totalGaps = tgtLayer - srcLayer;
    const srcN = isForward ? srcNode : tgtNode;
    const tgtN = isForward ? tgtNode : srcNode;

    // Port positions from pre-computed assignments
    const srcPortPos = getPort(portAssignments, isForward ? edge.from : edge.to, edge.id, 'out', srcN, isLR);
    const tgtPortPos = getPort(portAssignments, isForward ? edge.to : edge.from, edge.id, 'in', tgtN, isLR);

    if (totalGaps === 1) {
      // Single-gap edge — route normally
      gapSegments[srcLayer].push({
        edgeId: edge.id,
        sourcePos: srcPortPos,
        targetPos: tgtPortPos,
        gapIndex: 0,
        totalGaps: 1,
      });
    } else {
      // Long edge — use pre-computed pass-through position (may be refined with actual port positions)
      let passThrough = edgePassThrough.get(edge.id);
      if (passThrough === undefined) {
        passThrough = findPassThroughPos(
          nodes, layers, srcLayer, tgtLayer, srcPortPos, tgtPortPos, isLR, sp.edgeNode
        );
      }

      longEdgeAllocations.push({
        edgeId: edge.id,
        srcLayer,
        tgtLayer,
        passThrough,
        srcPortPos,
        tgtPortPos,
      });
    }
  }

  // Separate collinear long edges: when two long edges share intermediate layers
  // and have the same pass-through position, offset one to avoid visual overlap.
  separateCollinearLongEdges(longEdgeAllocations, sp.edgeEdge);

  // Reorder pass-through positions of collinear long edges to eliminate
  // double crossings (where both horizontal trunks of one edge cross
  // another edge's vertical trunk).
  fixDoubleCrossings(longEdgeAllocations);

  // Re-assign ports using final pass-through values so that port ordering
  // matches the actual routing direction after separation/fixDoubleCrossings.
  {
    let ptChanged = false;
    for (const alloc of longEdgeAllocations) {
      const orig = edgePassThrough.get(alloc.edgeId);
      if (orig !== undefined && Math.abs(orig - alloc.passThrough) > 0.1) {
        edgePassThrough.set(alloc.edgeId, alloc.passThrough);
        ptChanged = true;
      }
    }
    if (ptChanged) {
      const finalPorts = assignPorts(nodes, edges, nodeLayerIndex, isLR, edgePassThrough);
      // Build an edge lookup for efficiency
      const edgeById = new Map<string, LayoutEdge>();
      for (const e of edges) edgeById.set(e.id, e);
      // Update long edge allocation port positions
      for (const alloc of longEdgeAllocations) {
        const edge = edgeById.get(alloc.edgeId);
        if (!edge) continue;
        const srcLayer = nodeLayerIndex.get(edge.from)!;
        const tgtLayer = nodeLayerIndex.get(edge.to)!;
        const isForward = srcLayer <= tgtLayer;
        const srcN = nodes[isForward ? edge.from : edge.to];
        const tgtN = nodes[isForward ? edge.to : edge.from];
        if (!srcN || !tgtN) continue;
        alloc.srcPortPos = getPort(finalPorts, isForward ? edge.from : edge.to, alloc.edgeId, 'out', srcN, isLR);
        alloc.tgtPortPos = getPort(finalPorts, isForward ? edge.to : edge.from, alloc.edgeId, 'in', tgtN, isLR);
      }
      // Update single-gap segments already in gapSegments
      for (const segs of gapSegments) {
        for (const gs of segs) {
          if (gs.totalGaps !== 1) continue;
          const edge = edgeById.get(gs.edgeId);
          if (!edge) continue;
          const srcLayer = nodeLayerIndex.get(edge.from)!;
          const tgtLayer = nodeLayerIndex.get(edge.to)!;
          const isForward = srcLayer <= tgtLayer;
          const srcN = nodes[isForward ? edge.from : edge.to];
          const tgtN = nodes[isForward ? edge.to : edge.from];
          if (!srcN || !tgtN) continue;
          gs.sourcePos = getPort(finalPorts, isForward ? edge.from : edge.to, gs.edgeId, 'out', srcN, isLR);
          gs.targetPos = getPort(finalPorts, isForward ? edge.to : edge.from, gs.edgeId, 'in', tgtN, isLR);
        }
      }
    }
  }

  // Now create gap segments from (possibly adjusted) long edge allocations
  for (const alloc of longEdgeAllocations) {
    const totalGaps = alloc.tgtLayer - alloc.srcLayer;
    for (let g = 0; g < totalGaps; g++) {
      const gapIdx = alloc.srcLayer + g;
      const gs: GapSegment = {
        edgeId: alloc.edgeId,
        sourcePos: g === 0 ? alloc.srcPortPos : alloc.passThrough,
        targetPos: g === totalGaps - 1 ? alloc.tgtPortPos : alloc.passThrough,
        gapIndex: g,
        totalGaps,
      };
      gapSegments[gapIdx].push(gs);
    }
  }

  // Route each gap independently
  const edgeGapResults = new Map<string, GapSegmentResult[]>();

  for (let gapIdx = 0; gapIdx < gapSegments.length; gapIdx++) {
    const segs = gapSegments[gapIdx];
    if (segs.length === 0) continue;

    const startPos = gapStartPos[gapIdx];
    const hypers: HyperEdgeSegment[] = [];

    for (const gs of segs) {
      const segment = new HyperEdgeSegment();
      insertSorted(segment.incomingConnectionCoordinates, gs.sourcePos);
      insertSorted(segment.outgoingConnectionCoordinates, gs.targetPos);
      segment.recomputeExtent();
      segment.edgeIds.push(gs.edgeId);
      segment.edgePortPositions.set(gs.edgeId, { sourcePos: gs.sourcePos, targetPos: gs.targetPos });
      gs.segment = segment;
      hypers.push(segment);
    }

    routeEdgesBetweenLayers(hypers, sp.edgeEdge);

    // Collect results
    for (const gs of segs) {
      const seg = gs.segment!;
      if (seg.isDummy()) continue;

      const trunkPos = startPos + seg.routingSlot * sp.edgeEdge;
      const result: GapSegmentResult = {
        edgeId: gs.edgeId,
        gapIndex: gs.gapIndex,
        totalGaps: gs.totalGaps,
        sourcePos: gs.sourcePos,
        targetPos: gs.targetPos,
        trunkPos,
      };

      if (seg.splitPartner !== null) {
        result.splitLinkPos = seg.splitPartner.incomingConnectionCoordinates[0];
        result.splitTrunkPos = startPos + seg.splitPartner.routingSlot * sp.edgeEdge;
      }

      if (!edgeGapResults.has(gs.edgeId)) {
        edgeGapResults.set(gs.edgeId, []);
      }
      edgeGapResults.get(gs.edgeId)!.push(result);
    }
  }

  // Assemble final bend points for each edge
  for (const edge of edges) {
    const srcNode = nodes[edge.from];
    const tgtNode = nodes[edge.to];
    if (!srcNode || !tgtNode) continue;

    const results = edgeGapResults.get(edge.id);
    if (!results || results.length === 0) continue;

    // Sort by gapIndex
    results.sort((a, b) => a.gapIndex - b.gapIndex);

    let srcLayer = nodeLayerIndex.get(edge.from)!;
    let tgtLayer = nodeLayerIndex.get(edge.to)!;
    const isForward = srcLayer <= tgtLayer;
    const srcN = isForward ? srcNode : tgtNode;
    const tgtN = isForward ? tgtNode : srcNode;

    // Source/target exit/entry positions
    const srcExit = isLR ? srcN.x + srcN.width : srcN.y + srcN.height;
    const tgtEntry = isLR ? tgtN.x : tgtN.y;

    const points: { x: number; y: number }[] = [];

    for (let ri = 0; ri < results.length; ri++) {
      const r = results[ri];
      const isFirst = ri === 0;
      const isLast = ri === results.length - 1;

      if (isLR) {
        // LR: trunk is vertical (X = trunkPos), connections are Y coords
        if (isFirst) {
          // Source exit point
          points.push({ x: srcExit, y: r.sourcePos });
        }

        // Bend to trunk
        points.push({ x: r.trunkPos, y: r.sourcePos });

        // Split handling
        if (r.splitLinkPos !== undefined && r.splitTrunkPos !== undefined) {
          points.push({ x: r.trunkPos, y: r.splitLinkPos });
          points.push({ x: r.splitTrunkPos, y: r.splitLinkPos });
          // Continue from split partner's trunk
          points.push({ x: r.splitTrunkPos, y: r.targetPos });
        } else {
          // Bend to target
          points.push({ x: r.trunkPos, y: r.targetPos });
        }

        if (isLast) {
          // Target entry point
          points.push({ x: tgtEntry, y: r.targetPos });
        }
      } else {
        // TB: trunk is horizontal (Y = trunkPos), connections are X coords
        if (isFirst) {
          // Source exit point
          points.push({ x: r.sourcePos, y: srcExit });
        }

        // Straight vertical from source — only bend if sourcePos != previous targetPos
        if (Math.abs(r.sourcePos - r.targetPos) < TOLERANCE && !r.splitLinkPos) {
          // Straight through this gap — just add the trunk passage
          // Actually we need vertical segments through the trunk
          points.push({ x: r.sourcePos, y: r.trunkPos });
          if (isLast) {
            points.push({ x: r.targetPos, y: tgtEntry });
          }
        } else {
          // Bend to trunk
          points.push({ x: r.sourcePos, y: r.trunkPos });

          // Split handling
          if (r.splitLinkPos !== undefined && r.splitTrunkPos !== undefined) {
            points.push({ x: r.splitLinkPos, y: r.trunkPos });
            points.push({ x: r.splitLinkPos, y: r.splitTrunkPos });
            points.push({ x: r.targetPos, y: r.splitTrunkPos });
          } else {
            points.push({ x: r.targetPos, y: r.trunkPos });
          }

          if (isLast) {
            points.push({ x: r.targetPos, y: tgtEntry });
          }
        }
      }
    }

    // For reversed edges, reverse the points
    if (!isForward) {
      points.reverse();
    }

    // Remove consecutive duplicate points
    const cleaned: { x: number; y: number }[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = cleaned[cleaned.length - 1];
      if (Math.abs(points[i].x - prev.x) > TOLERANCE || Math.abs(points[i].y - prev.y) > TOLERANCE) {
        cleaned.push(points[i]);
      }
    }

    edge.points = cleaned;
    edge.orthoRouted = true;

    // Reposition edge labels to match the new orthogonal route.
    // CENTER label → below/beside the trunk (longest segment), matching ELK style.
    // TAIL (cardFrom) → midpoint of the first segment.
    // HEAD (cardTo) → midpoint of the last segment.
    if (cleaned.length >= 2) {
      if (edge.labelPos) {
        const { idx } = longestSegment(cleaned);
        const a = cleaned[idx], b = cleaned[idx + 1];
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        if (edge.labelSize) {
          // Place label beside the trunk segment with edgeLabelSpacing offset
          const isHoriz = Math.abs(b.y - a.y) < TOLERANCE;
          if (isHoriz) {
            // Horizontal trunk (TB layout) → label below
            edge.labelPos = { x: midX, y: midY + sp.edgeLabelSpacing + edge.labelSize.height / 2 };
          } else {
            // Vertical trunk (LR layout) → label to the right
            edge.labelPos = { x: midX + sp.edgeLabelSpacing + edge.labelSize.width / 2, y: midY };
          }
        } else {
          edge.labelPos = { x: midX, y: midY };
        }
      }
      if (edge.cardFromPos) {
        edge.cardFromPos = segmentMidpoint(cleaned, 0);
      }
      if (edge.cardToPos) {
        edge.cardToPos = segmentMidpoint(cleaned, cleaned.length - 2);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Edge label helpers
// ---------------------------------------------------------------------------

/** Return the index of the longest segment (by Manhattan distance). */
function longestSegment(pts: { x: number; y: number }[]): { idx: number; len: number } {
  let best = 0, bestLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  return { idx: best, len: bestLen };
}

/** Midpoint of segment at index `idx`. */
function segmentMidpoint(pts: { x: number; y: number }[], idx: number): { x: number; y: number } {
  const a = pts[idx], b = pts[idx + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ---------------------------------------------------------------------------
// Port assignment — distribute multiple edges evenly across node sides
// ---------------------------------------------------------------------------

/**
 * For each node, record ordered edge-port positions on its outgoing (south/east)
 * and incoming (north/west) sides.
 *
 * Key: `${nodeId}:${direction}:${edgeId}`  →  position on port axis
 */
type PortMap = Map<string, number>;

function portKey(nodeId: string, edgeId: string, dir: 'in' | 'out'): string {
  return nodeId + ':' + dir + ':' + edgeId;
}

/**
 * Assign port positions for all edge–node connections.
 *
 * For TB: ports are distributed along the X axis of the node border.
 * For LR: ports are distributed along the Y axis of the node border.
 *
 * Edges are sorted by the effective trajectory position so that
 * port ordering minimizes crossings.  For long edges (spanning >1 gap),
 * the pass-through position is used instead of the far-end node center
 * because the actual path detours through that position.
 */
function assignPorts(
  nodes: Record<string, LayoutNode>,
  edges: LayoutEdge[],
  nodeLayerIndex: Map<string, number>,
  isLR: boolean,
  edgePassThrough?: Map<string, number>,
): PortMap {
  const portMap: PortMap = new Map();

  // Collect edges per node and direction
  // nodeOutEdges: edges leaving this node (going to higher layer)
  // nodeInEdges:  edges entering this node (coming from lower layer)
  const nodeOutEdges = new Map<string, { edgeId: string; otherPos: number }[]>();
  const nodeInEdges = new Map<string, { edgeId: string; otherPos: number }[]>();

  for (const edge of edges) {
    const srcNode = nodes[edge.from];
    const tgtNode = nodes[edge.to];
    if (!srcNode || !tgtNode) continue;

    let srcLayer = nodeLayerIndex.get(edge.from);
    let tgtLayer = nodeLayerIndex.get(edge.to);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer === tgtLayer) continue;

    const isForward = srcLayer < tgtLayer;
    const outNodeId = isForward ? edge.from : edge.to;
    const inNodeId = isForward ? edge.to : edge.from;
    const outNode = isForward ? srcNode : tgtNode;
    const inNode = isForward ? tgtNode : srcNode;

    // Position of the other endpoint on the port axis (for sorting).
    // For long edges, use pass-through position (the actual path trajectory)
    // instead of the far-end node center, because the path detours there.
    const pt = edgePassThrough?.get(edge.id);
    const inOtherPos = pt !== undefined ? pt : (isLR ? outNode.y + outNode.height / 2 : outNode.x + outNode.width / 2);
    const outOtherPos = pt !== undefined ? pt : (isLR ? inNode.y + inNode.height / 2 : inNode.x + inNode.width / 2);

    if (!nodeOutEdges.has(outNodeId)) nodeOutEdges.set(outNodeId, []);
    nodeOutEdges.get(outNodeId)!.push({ edgeId: edge.id, otherPos: outOtherPos });

    if (!nodeInEdges.has(inNodeId)) nodeInEdges.set(inNodeId, []);
    nodeInEdges.get(inNodeId)!.push({ edgeId: edge.id, otherPos: inOtherPos });
  }

  // Distribute ports for each node side
  const distribute = (nodeId: string, dir: 'in' | 'out', items: { edgeId: string; otherPos: number }[]) => {
    const node = nodes[nodeId];
    if (!node || items.length === 0) return;

    // Sort by other-end position so wires don't cross
    items.sort((a, b) => a.otherPos - b.otherPos);

    // Port axis: X range for TB, Y range for LR
    const axisStart = isLR ? node.y : node.x;
    const axisLen = isLR ? node.height : node.width;

    // N edges → divide side into (N+1) equal parts, place at boundaries
    const division = axisLen / (items.length + 1);
    for (let i = 0; i < items.length; i++) {
      portMap.set(portKey(nodeId, items[i].edgeId, dir), axisStart + division * (i + 1));
    }
  };

  for (const entry of Array.from(nodeOutEdges)) {
    distribute(entry[0], 'out', entry[1]);
  }
  for (const entry of Array.from(nodeInEdges)) {
    distribute(entry[0], 'in', entry[1]);
  }

  return portMap;
}

/** Look up a pre-assigned port position, falling back to node center. */
function getPort(
  portMap: PortMap,
  nodeId: string,
  edgeId: string,
  dir: 'in' | 'out',
  node: LayoutNode,
  isLR: boolean,
): number {
  const key = portKey(nodeId, edgeId, dir);
  const pos = portMap.get(key);
  if (pos !== undefined) return pos;
  // Fallback: center
  return isLR ? node.y + node.height / 2 : node.x + node.width / 2;
}

// ---------------------------------------------------------------------------
// Layer reconstruction from DOT node positions
// ---------------------------------------------------------------------------

/**
 * Group nodes into layers based on their position coordinate.
 * For TB layout, layers are rows (grouped by Y center).
 * For LR layout, layers are columns (grouped by X center).
 * Returns layers sorted by ascending coordinate.
 */
function buildLayers(nodes: Record<string, LayoutNode>, useX: boolean): string[][] {
  // Collect center coordinates
  const coords: { id: string; center: number }[] = [];
  for (const [id, node] of Object.entries(nodes)) {
    const center = useX ? node.x + node.width / 2 : node.y + node.height / 2;
    coords.push({ id, center });
  }
  coords.sort((a, b) => a.center - b.center);

  // Cluster nodes with centers close together (within tolerance) into the same layer
  const LAYER_TOLERANCE = 5; // nodes within 5px of the cluster representative are same layer
  const layers: { center: number; nodes: string[] }[] = [];

  for (const { id, center } of coords) {
    // Find existing layer close enough
    let found = false;
    for (const layer of layers) {
      if (Math.abs(center - layer.center) <= LAYER_TOLERANCE) {
        layer.nodes.push(id);
        found = true;
        break;
      }
    }
    if (!found) {
      layers.push({ center, nodes: [id] });
    }
  }

  // Sort layers by center coordinate (already sorted by construction)
  return layers.map(l => l.nodes);
}

// ---------------------------------------------------------------------------
// Preprocessing: adjust node spacing for long-edge pass-through
// ---------------------------------------------------------------------------

/**
 * Adapt layer spacing based on edge complexity per gap.
 *
 * For each gap between adjacent layers, count the total number of edges
 * crossing it (both direct edges and long-edge pass-throughs). Then set
 * the gap to:
 *   desiredGap = edgeNode + N × edgeEdge + labelExtra
 *
 * Adapt layer spacing based on edge complexity per gap.
 *
 * For each gap between adjacent layers, classify crossing edges:
 *   - "trunk" edges: edges whose source or target is at one of the
 *     adjacent layers — these produce visible horizontal trunk segments.
 *   - "pass-through" edges: long edges passing through intermediate
 *     gaps — only vertical lines, no visible horizontal trunk.
 *
 * Desired gap:
 *   - If trunk edges exist:  edgeNode + totalEdges * edgeEdge + edgeNode
 *     (clearance on BOTH source and target sides, plus routing slots)
 *   - If only pass-throughs:  edgeNode + totalEdges * edgeEdge
 *     (clearance on source side only;  straight verticals need less room)
 *   - Plus labelExtra for center labels.
 */
function adjustNodeSpacing(
  nodes: Record<string, LayoutNode>,
  edges: LayoutEdge[],
  layers: string[][],
  nodeLayerIndex: Map<string, number>,
  sp: RoutingSpacing,
  isLR: boolean,
  groups?: Record<string, LayoutGroup>,
): void {
  if (layers.length < 2) return;

  const numGaps = layers.length - 1;

  // Per-gap: count edges that have a horizontal trunk (fold-line) in this gap.
  // Pass-through edges (vertical only) don't need extra vertical space.
  const gapTrunkCount = new Array(numGaps).fill(0) as number[];
  // Whether any edge has a visible horizontal trunk in this gap
  const gapHasTrunk = new Array(numGaps).fill(false) as boolean[];

  // Max label dimension per gap (for center labels placed in the middle gap)
  const gapLabelExtra = new Array(numGaps).fill(0) as number[];

  for (const edge of edges) {
    let srcLayer = nodeLayerIndex.get(edge.from);
    let tgtLayer = nodeLayerIndex.get(edge.to);
    if (srcLayer === undefined || tgtLayer === undefined) continue;
    if (srcLayer > tgtLayer) { const tmp = srcLayer; srcLayer = tgtLayer; tgtLayer = tmp; }
    if (srcLayer === tgtLayer) continue;

    for (let gi = srcLayer; gi < tgtLayer; gi++) {
      // Edge has a trunk endpoint in this gap if its source or target
      // is at one of the adjacent layers (not just passing through)
      if (gi === srcLayer || gi + 1 === tgtLayer) {
        gapTrunkCount[gi]++;
        gapHasTrunk[gi] = true;
      }
    }

    // Reserve gap space for center labels
    if (edge.labelSize && tgtLayer > srcLayer) {
      const midGap = srcLayer + Math.floor((tgtLayer - srcLayer) / 2);
      const labelDim = isLR ? edge.labelSize.width : edge.labelSize.height;
      gapLabelExtra[midGap] = Math.max(gapLabelExtra[midGap], labelDim + sp.edgeLabelSpacing);
    }
  }

  // Compute layer extents on the layout axis
  const layerBottom: number[] = []; // max bottom of each layer
  const layerTop: number[] = [];    // min top of each layer
  for (let li = 0; li < layers.length; li++) {
    let maxB = -Infinity, minT = Infinity;
    for (const nid of layers[li]) {
      const n = nodes[nid];
      if (!n) continue;
      const top = isLR ? n.x : n.y;
      const bottom = isLR ? n.x + n.width : n.y + n.height;
      minT = Math.min(minT, top);
      maxB = Math.max(maxB, bottom);
    }
    layerBottom.push(maxB);
    layerTop.push(minT);
  }

  // Compute per-gap delta (desired - actual).
  const gapDelta: number[] = [];
  for (let gi = 0; gi < numGaps; gi++) {
    const actual = layerTop[gi + 1] - layerBottom[gi];
    // Source-side clearance + trunk routing slots + target-side clearance (if trunks)
    const desired = sp.edgeNode
      + gapTrunkCount[gi] * sp.edgeEdge
      + (gapHasTrunk[gi] ? sp.edgeNode : 0)
      + gapLabelExtra[gi];
    gapDelta.push(desired - actual);
  }

  // Apply cumulative shifts (layer 0 stays in place)
  const layerCumShift: number[] = [0];
  let cumulativeShift = 0;
  for (let li = 1; li < layers.length; li++) {
    cumulativeShift += gapDelta[li - 1];
    layerCumShift.push(cumulativeShift);
    for (const nid of layers[li]) {
      const n = nodes[nid];
      if (n) {
        if (isLR) n.x += cumulativeShift;
        else n.y += cumulativeShift;
      }
    }
  }

  // Adjust groups: use per-layer shifts for position and size
  if (groups) {
    for (const g of Object.values(groups)) {
      const gStart = isLR ? g.x : g.y;
      const gEnd = gStart + (isLR ? g.width : g.height);

      // Find first layer at/after group start
      let firstLayer = 0;
      for (let li = 0; li < layers.length; li++) {
        if (layerTop[li] >= gStart - 5) { firstLayer = li; break; }
      }
      // Find last layer at/before group end
      let lastLayer = layers.length - 1;
      for (let li = layers.length - 1; li >= 0; li--) {
        if (layerBottom[li] <= gEnd + 5) { lastLayer = li; break; }
      }

      const topShift = layerCumShift[firstLayer];
      const bottomShift = layerCumShift[lastLayer];

      if (isLR) {
        g.x += topShift;
        g.width += (bottomShift - topShift);
      } else {
        g.y += topShift;
        g.height += (bottomShift - topShift);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Long-edge pass-through position (avoids intermediate-layer nodes)
// ---------------------------------------------------------------------------

function overlapsAnyNode(pos: number, intervals: { min: number; max: number }[]): boolean {
  for (const iv of intervals) {
    if (pos > iv.min && pos < iv.max) return true;
  }
  return false;
}

/**
 * Find a coordinate on the port axis (X for TB, Y for LR) for a long edge
 * to pass through intermediate layers without crossing nodes.
 */
function findPassThroughPos(
  nodes: Record<string, LayoutNode>,
  layers: string[][],
  srcLayer: number,
  tgtLayer: number,
  srcPortPos: number,
  tgtPortPos: number,
  isLR: boolean,
  edgeNode: number,
): number {
  // Collect node intervals in intermediate layers
  const intervals: { min: number; max: number }[] = [];
  for (let li = srcLayer + 1; li < tgtLayer; li++) {
    for (const nid of layers[li]) {
      const n = nodes[nid];
      if (!n) continue;
      const min = isLR ? n.y : n.x;
      const max = isLR ? n.y + n.height : n.x + n.width;
      intervals.push({ min, max });
    }
  }

  if (intervals.length === 0) return tgtPortPos;

  // Try target port position (most common case)
  if (!overlapsAnyNode(tgtPortPos, intervals)) return tgtPortPos;

  // Try source port position
  if (!overlapsAnyNode(srcPortPos, intervals)) return srcPortPos;

  // Try midpoint
  const mid = (srcPortPos + tgtPortPos) / 2;
  if (!overlapsAnyNode(mid, intervals)) return mid;

  // Find global bounds and go outside
  let globalMin = Infinity, globalMax = -Infinity;
  for (const iv of intervals) {
    globalMin = Math.min(globalMin, iv.min);
    globalMax = Math.max(globalMax, iv.max);
  }

  const leftPos = globalMin - edgeNode;
  const rightPos = globalMax + edgeNode;

  // Pick whichever side is closer to the target
  if (Math.abs(leftPos - tgtPortPos) <= Math.abs(rightPos - tgtPortPos)) {
    return leftPos;
  }
  return rightPos;
}

// ---------------------------------------------------------------------------
// Collinear long-edge separation
// ---------------------------------------------------------------------------

interface LongEdgeAllocation {
  edgeId: string;
  srcLayer: number;
  tgtLayer: number;
  passThrough: number;
  srcPortPos: number;
  tgtPortPos: number;
}

/**
 * Detect and separate long edges that share intermediate layers and have the
 * same pass-through position (collinear overlap).
 *
 * Two long edges are collinear when their intermediate layer ranges overlap
 * and their passThrough values are equal. We offset later edges by edgeEdge
 * spacing to visually separate them.
 */
function separateCollinearLongEdges(allocs: LongEdgeAllocation[], edgeEdge: number): void {
  for (let i = 0; i < allocs.length; i++) {
    for (let j = i + 1; j < allocs.length; j++) {
      const a = allocs[i], b = allocs[j];
      if (Math.abs(a.passThrough - b.passThrough) > TOLERANCE) continue;

      // Check intermediate layer overlap:
      // Edge A intermediates: [srcLayer+1 .. tgtLayer-1]
      // Edge B intermediates: [srcLayer+1 .. tgtLayer-1]
      const aStart = a.srcLayer + 1, aEnd = a.tgtLayer - 1;
      const bStart = b.srcLayer + 1, bEnd = b.tgtLayer - 1;
      if (aStart > bEnd || bStart > aEnd) continue;

      // Collinear conflict — offset edge B's passThrough
      b.passThrough += edgeEdge;
    }
  }
}

/**
 * Fix double-crossings between collinear long edges.
 *
 * A double crossing occurs when edge B's horizontal trunks (at source and
 * target) both cross edge A's vertical trunk.  This happens when B's
 * pass-through is on the opposite side of A's pass-through from BOTH of
 * B's port positions.
 *
 * Fix: for collinear edge pairs whose pass-through ordering disagrees with
 * their average port-position ordering, swap the pass-through values.
 * This ensures the edge with ports closer to the pass-through area is
 * the outermost vertical, preventing trunks from crossing.
 */
function fixDoubleCrossings(allocs: LongEdgeAllocation[]): void {
  // Iterative pairwise swaps until stable
  let changed = true;
  let maxIter = allocs.length * allocs.length;
  while (changed && maxIter-- > 0) {
    changed = false;
    for (let i = 0; i < allocs.length; i++) {
      for (let j = i + 1; j < allocs.length; j++) {
        const a = allocs[i], b = allocs[j];

        // Check overlapping intermediate layer ranges
        const aStart = a.srcLayer + 1, aEnd = a.tgtLayer - 1;
        const bStart = b.srcLayer + 1, bEnd = b.tgtLayer - 1;
        if (aStart > bEnd || bStart > aEnd) continue;

        // Count crossings before and after a potential swap
        const crossBefore = countPairCrossings(a, b);
        if (crossBefore === 0) continue;

        // Try swapping
        const tmp = a.passThrough;
        a.passThrough = b.passThrough;
        b.passThrough = tmp;

        const crossAfter = countPairCrossings(a, b);
        if (crossAfter < crossBefore) {
          changed = true; // keep the swap
        } else {
          // Revert
          b.passThrough = a.passThrough;
          a.passThrough = tmp;
        }
      }
    }
  }
}

/**
 * Count crossings between two long edges' horizontal trunks and
 * the other edge's vertical trunk.
 *
 * A crossing occurs when edge X's horizontal trunk at some layer gap
 * spans across edge Y's vertical pass-through position at that same gap.
 */
function countPairCrossings(a: LongEdgeAllocation, b: LongEdgeAllocation): number {
  let crossings = 0;

  // A's source trunk crosses B's vertical?
  // A's source trunk is at gap srcLayerA, connecting srcPortPosA → passThroughA
  // B's vertical exists in gaps [srcLayerB .. tgtLayerB-1]
  if (a.srcLayer >= b.srcLayer && a.srcLayer < b.tgtLayer) {
    if (straddles(a.srcPortPos, a.passThrough, b.passThrough)) crossings++;
  }
  // A's target trunk at gap tgtLayerA-1
  if (a.tgtLayer - 1 >= b.srcLayer && a.tgtLayer - 1 < b.tgtLayer) {
    if (straddles(a.tgtPortPos, a.passThrough, b.passThrough)) crossings++;
  }
  // B's source trunk crosses A's vertical?
  if (b.srcLayer >= a.srcLayer && b.srcLayer < a.tgtLayer) {
    if (straddles(b.srcPortPos, b.passThrough, a.passThrough)) crossings++;
  }
  // B's target trunk
  if (b.tgtLayer - 1 >= a.srcLayer && b.tgtLayer - 1 < a.tgtLayer) {
    if (straddles(b.tgtPortPos, b.passThrough, a.passThrough)) crossings++;
  }

  return crossings;
}

/** Check if a horizontal trunk from portPos to ownPT crosses the line at otherPT. */
function straddles(portPos: number, ownPT: number, otherPT: number): boolean {
  // The trunk spans from portPos to ownPT.  It crosses otherPT if
  // otherPT is strictly between portPos and ownPT.
  const lo = Math.min(portPos, ownPT);
  const hi = Math.max(portPos, ownPT);
  return otherPT > lo + TOLERANCE && otherPT < hi - TOLERANCE;
}
