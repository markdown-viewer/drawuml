/**
 * DOT adapter — converts LayoutGraphNode IR + SemanticModel into a DOT string.
 *
 * This replaces the old buildDot() approach that called Renderer.buildDotBlock().
 * Instead it walks the LayoutGraphNode tree produced by buildLayoutGraph().
 */

import type { LayoutGraphNode, LayoutPort } from '../layout-graph.ts';
import type { SemanticModel, SemanticEdge, SemanticGroup } from '../../model/index.ts';
import { Renderer } from '../../primitives/renderer.ts';
import { unescapePlantUml } from '../../shared/puml-unescape.ts';
import { createTheme, type Theme } from '../../shared/theme.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PX_PER_INCH = 72;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert pixel dimensions to DOT inches string.
 */
function pxToInch(px: number): string {
  return String(px / PX_PER_INCH);
}

/**
 * Build DOT node attribute string from a LayoutGraphNode.
 *
 * If the node has ports and hasPortEdges is true, emit an HTML port label.
 * If the node has labels (xlabel), emit xlabel attribute.
 * Otherwise emit a plain fixed-size rect.
 */
function buildNodeAttrs(gn: LayoutGraphNode, hasPortEdges: boolean): string {
  const wInch = pxToInch(gn.width);
  const hInch = pxToInch(gn.height);

  // Port label (field-level edge routing)
  if (hasPortEdges && gn.ports && gn.ports.length > 0) {
    const htmlLabel = buildPortHtmlLabel(gn);
    if (htmlLabel) {
      return `shape=none,fixedsize=true,width=${wInch},height=${hInch},label=${htmlLabel}`;
    }
  }

  let attrs = `shape=rect,fixedsize=true,width=${wInch},height=${hInch},label=""`;

  // External label (xlabel) for nodes like state_choice
  if (gn.labels && gn.labels.length > 0) {
    const escaped = gn.labels[0].text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    attrs += `,xlabel="${escaped}"`;
  }

  return attrs;
}

/**
 * Build DOT HTML port label from LayoutGraphNode ports.
 *
 * Generates a TABLE with one row per port, each row having a PORT attribute
 * for field-level edge routing.
 */
function buildPortHtmlLabel(gn: LayoutGraphNode): string | null {
  if (!gn.ports || gn.ports.length === 0) return null;

  // DOT HTML labels require integer pixel values
  const W = Math.round(gn.width);
  const H = Math.round(gn.height);
  const rows: string[] = [];
  let prevBottom = 0;

  for (const port of gn.ports) {
    const portY = Math.round(port.y ?? prevBottom);
    // Fill gap between previous port bottom and current port top
    const gap = portY - prevBottom;
    if (gap > 0) {
      rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${gap}" WIDTH="${W}"> </TD></TR>`);
    }
    // Port row with PORT attribute
    const portName = port.id.includes('::') ? port.id.split('::').slice(1).join('::') : port.id;
    const safePort = portName
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    const pH = Math.round(port.height);
    rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${pH}" WIDTH="${W}" PORT="${safePort}"> </TD></TR>`);
    prevBottom = portY + pH;
  }

  // Fill remaining space at the bottom
  const remaining = H - prevBottom;
  if (remaining > 0) {
    rows.push(`<TR><TD FIXEDSIZE="TRUE" HEIGHT="${remaining}" WIDTH="${W}"> </TD></TR>`);
  }

  return `<\n<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="0" FIXEDSIZE="TRUE" WIDTH="${W}" HEIGHT="${H}">\n${rows.join('\n')}\n</TABLE>\n>`;
}

// ---------------------------------------------------------------------------
// Adapter context — holds pre-computed analysis results
// ---------------------------------------------------------------------------

interface DotAdapterContext {
  /** Node IDs that have port-connected edges */
  portNodes: Set<string>;
  /** Group IDs that need invisible proxy nodes for compound edges */
  groupsNeedingProxy: Set<string>;
  /** Group IDs with at least one external edge (need larger margin) */
  groupsWithExternalEdge: Set<string>;
  /** Node IDs that are connected by at least one edge */
  connectedNodes: Set<string>;
  /** Map of all renderers */
  renderers: Map<string, Renderer>;
  /** Group lookup by ID */
  groupById: Map<string, SemanticGroup>;
  /** Greedy bin-packing for orphan nodes into rows */
  buildRowPacking: (nodeIds: string[], indent: string, maxRowWidth: number, maxPerRow: number) => string[];
  /** Maximum row width for bin-packing */
  maxRowWidth: number;
  /** Nodesep value in pixels */
  nodesepPx: number;
  /** Font size for region/lane cluster labels (matches ConcurrentRegionRenderer) */
  smallFontSize: number;
  /** Font size for cluster labels */
  fontSize: number;
  /** Group container inner padding (DOT cluster margin) */
  groupPadding: number;
  /** Inter-group spacing (DOT outer protection margin) */
  groupSpacing: number;
}

// ---------------------------------------------------------------------------
// Cluster (container) DOT block generation
// ---------------------------------------------------------------------------

/**
 * Recursively build DOT lines for a LayoutGraphNode tree.
 *
 * Leaf nodes → single node declaration.
 * Container nodes (with children) → subgraph cluster with protection wrapper.
 */
function buildNodeDotLines(
  gn: LayoutGraphNode,
  indent: string,
  ctx: DotAdapterContext,
): string[] {
  // Leaf node
  if (!gn.children || gn.children.length === 0) {
    const attrs = buildNodeAttrs(gn, ctx.portNodes.has(gn.id));
    return [`${indent}"${gn.id}" [${attrs}]`];
  }

  // ── Activity swimlane container: lane clusters ─────────────────────
  // Each region becomes a cluster. DOT with newrank=true handles
  // cross-cluster ranking and edge routing correctly.
  const group = ctx.groupById.get(gn.id);
  if (group?.type === 'swimlane_container' && group.concurrentRegions && group.concurrentRegions.length > 1) {
    const lines: string[] = [];
    // Outer container - invisible wrapper
    lines.push(`${indent}subgraph "cluster_${gn.id}_p0" {`);
    lines.push(`${indent}  label=""`);
    lines.push(`${indent}  margin="${ctx.groupSpacing}"`);
    const inner = indent + '  ';
    lines.push(`${inner}subgraph "cluster_${gn.id}" {`);
    lines.push(`${inner}  label=""`);
    lines.push(`${inner}  style=invis`);
    lines.push(`${inner}  margin="0"`);
    // Each region child as its own cluster with zero protection margin
    for (const regionChild of gn.children) {
      const regionLabel = regionChild.label || '';
      const inner2 = inner + '  ';
      lines.push(`${inner2}subgraph "cluster_${regionChild.id}_p0" {`);
      lines.push(`${inner2}  label=""`);
      lines.push(`${inner2}  margin="0"`);
      lines.push(`${inner2}  subgraph "cluster_${regionChild.id}" {`);
      lines.push(`${inner2}    label="${regionLabel}"`);
      lines.push(`${inner2}    fontsize=${ctx.smallFontSize}`);
      lines.push(`${inner2}    style=rounded`);
      lines.push(`${inner2}    margin="${ctx.groupPadding}"`)
      // Lane's leaf nodes
      if (regionChild.children) {
        for (const leaf of regionChild.children) {
          lines.push(...buildNodeDotLines(leaf, inner2 + '    ', ctx));
        }
      }
      lines.push(`${inner2}  }`);
      lines.push(`${inner2}}`);
    }
    lines.push(`${inner}}`);
    lines.push(`${indent}}`);
    return lines;
  }

  // Container node → DOT subgraph cluster
  const lines: string[] = [];

  // Outer protection subgraph (mirrors PlantUML's "p0" wrapper)
  const outerMargin = ctx.groupsWithExternalEdge.has(gn.id)
    ? ctx.nodesepPx
    : ctx.groupSpacing;
  lines.push(`${indent}subgraph "cluster_${gn.id}_p0" {`);
  lines.push(`${indent}  label=""`);
  lines.push(`${indent}  margin="${outerMargin}"`);

  const inner = indent + '  ';
  const label = gn.label ?? '';
  lines.push(`${inner}subgraph "cluster_${gn.id}" {`);
  lines.push(`${inner}  label="${label}"`);
  // Per-cluster fontsize: derive from renderer's groupTopPadding so titlebar
  // shapes get a larger label area than non-titlebar shapes.
  const renderer = ctx.renderers.get(gn.id);
  const titleArea = renderer ? renderer.groupTopPadding - ctx.groupPadding : 0;
  const fs = Math.round(Math.max(1, (titleArea - 8) / 1.2));
  lines.push(`${inner}  fontsize=${fs}`);
  lines.push(`${inner}  style=rounded`);
  // Concurrent region parents need zero inner margin — regions fill the full area.
  // Detection: child IDs containing '__conc_region__'.
  const hasConcRegion = gn.children?.some(c => c.id.includes('__conc_region__'));
  lines.push(`${inner}  margin="${hasConcRegion ? 0 : ctx.groupPadding}"`);

  // Invisible proxy node for compound edges targeting this group
  if (ctx.groupsNeedingProxy.has(gn.id)) {
    lines.push(`${inner}  "__proxy_${gn.id}" [shape=point,width=0.01,height=0.01,style=invis,label=""]`);
  }

  // Ensure empty clusters get a bounding box
  const hasContent = gn.children.length > 0 || ctx.groupsNeedingProxy.has(gn.id);
  if (!hasContent) {
    lines.push(`${inner}  "__empty_${gn.id}" [shape=point,width=0.01,height=0.01,style=invis,label=""]`);
  }

  // Recurse into children
  const portChildren: LayoutGraphNode[] = [];
  const normalChildren: LayoutGraphNode[] = [];
  for (const child of gn.children) {
    const r = ctx.renderers.get(child.id);
    if (r?.isPort) {
      portChildren.push(child);
    } else {
      normalChildren.push(child);
    }
    lines.push(...buildNodeDotLines(child, inner + '  ', ctx));
  }

  // rank=source pins portin nodes; rank=sink pins portout nodes
  const portinIds = portChildren
    .filter(c => ctx.renderers.get(c.id)?.portKind !== 'portout')
    .map(c => `"${c.id}"`);
  if (portinIds.length > 0) {
    lines.push(`${inner}  {rank=source; ${portinIds.join('; ')}}`);
  }
  const portoutIds = portChildren
    .filter(c => ctx.renderers.get(c.id)?.portKind === 'portout')
    .map(c => `"${c.id}"`);
  if (portoutIds.length > 0) {
    lines.push(`${inner}  {rank=sink; ${portoutIds.join('; ')}}`);
  }

  // Row-packing for leaf normal children
  const leafNormal = normalChildren.filter(c => !c.children || c.children.length === 0);
  const totalItems = normalChildren.length;
  const targetCols = Math.max(Math.ceil(Math.sqrt(totalItems)), 2);
  const leafIds = leafNormal.map(c => c.id);
  lines.push(...ctx.buildRowPacking(leafIds, inner + '  ', ctx.maxRowWidth, targetCols));

  lines.push(`${inner}}`);
  lines.push(`${indent}}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Convert a LayoutGraphNode IR tree + SemanticModel into a DOT digraph string.
 *
 * This is a drop-in replacement for the old `buildDot()` function but operates
 * on the engine-agnostic LayoutGraphNode IR instead of calling Renderer.buildDotBlock().
 */
export function layoutGraphToDot(
  rootNodes: LayoutGraphNode[],
  model: SemanticModel,
  renderers: Map<string, Renderer>,
  theme: Theme = createTheme(),
): { dot: string; groupIds: Set<string> } {
  const rankdir = model.rankdir || 'TB';
  const nodesepPx = Math.round(theme.padL);
  const ranksepPx = Math.round(theme.padXXL);
  const maxRowWidth = theme.sizeMax;
  const layoutFontSize = Math.round(theme.fontSize);
  const dotMinH = String(theme.sizeS / PX_PER_INCH);
  const dotMinW = String(theme.sizeL / PX_PER_INCH);
  const nodesepInch = pxToInch(nodesepPx);
  const ranksepInch = pxToInch(ranksepPx);

  // --- Compound edge analysis ---

  // Detect which groups produce DOT clusters
  const groupIds = new Set<string>();
  for (const g of model.groups || []) {
    const gr = renderers.get(g.id);
    if (gr && gr.isCluster) groupIds.add(g.id);
  }

  // Groups that participate in edges
  const groupsInEdges = new Set<string>();
  for (const edge of model.edges) {
    if (groupIds.has(edge.from)) groupsInEdges.add(edge.from);
    if (groupIds.has(edge.to)) groupsInEdges.add(edge.to);
  }

  // Port-connected nodes
  const portNodes = new Set<string>();
  for (const edge of model.edges) {
    if (edge.fromPort) portNodes.add(edge.from);
    if (edge.toPort) portNodes.add(edge.to);
  }

  // Group lookup
  const groupById = new Map<string, SemanticGroup>();
  for (const g of model.groups || []) {
    groupById.set(g.id, g);
  }

  // Find a representative descendant leaf node for compound edge proxy
  function findRepresentativeNode(groupId: string): string | undefined {
    const g = groupById.get(groupId);
    if (!g) return undefined;
    if (g.children.length > 0) return g.children[0];
    for (const cgId of g.childGroups) {
      const rep = findRepresentativeNode(cgId);
      if (rep) return rep;
    }
    return undefined;
  }

  // Check if groupA is ancestor of groupB
  function isAncestorGroup(ancestorId: string, descendantId: string): boolean {
    let cur = groupById.get(descendantId);
    while (cur && cur.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = groupById.get(cur.parentId);
    }
    return false;
  }

  // Determine which groups need proxy nodes
  const groupsNeedingProxy = new Set<string>();
  for (const edge of model.edges) {
    const isFromGroup = groupIds.has(edge.from);
    const isToGroup = groupIds.has(edge.to);
    if (isFromGroup && isToGroup) {
      if (isAncestorGroup(edge.from, edge.to)) groupsNeedingProxy.add(edge.from);
      else if (isAncestorGroup(edge.to, edge.from)) groupsNeedingProxy.add(edge.to);
    }
  }

  // groupId → DOT node name for edge endpoints
  const groupRepNode = new Map<string, string>();
  groupsInEdges.forEach(gId => {
    if (groupsNeedingProxy.has(gId)) {
      groupRepNode.set(gId, `"__proxy_${gId}"`);
    } else {
      const rep = findRepresentativeNode(gId);
      if (rep) {
        groupRepNode.set(gId, `"${rep}"`);
      } else {
        groupsNeedingProxy.add(gId);
        groupRepNode.set(gId, `"__proxy_${gId}"`);
      }
    }
  });

  // --- Connected nodes + row packing ---

  const connectedNodes = new Set<string>();
  for (const e of model.edges) {
    connectedNodes.add(e.from);
    connectedNodes.add(e.to);
  }

  function buildRowPacking(nodeIds: string[], indent: string, maxRowWidth_ = maxRowWidth, maxPerRow = 0): string[] {
    const orphans = nodeIds.filter(id => !connectedNodes.has(id));
    if (orphans.length <= 1) return [];
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentWidth = 0;

    for (const id of orphans) {
      const r = renderers.get(id);
      const w = r ? r.measure().width : 160;
      const needed = currentRow.length > 0 ? w + nodesepPx : w;
      const widthExceeded = currentRow.length > 0 && currentWidth + needed > maxRowWidth_;
      const countExceeded = maxPerRow > 0 && currentRow.length >= maxPerRow;
      if (currentRow.length > 0 && (widthExceeded || countExceeded)) {
        rows.push(currentRow);
        currentRow = [id];
        currentWidth = w;
      } else {
        currentRow.push(id);
        currentWidth += needed;
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);
    if (rows.length <= 1) return [];

    const lines: string[] = [];
    for (const row of rows) {
      const ids = row.map(id => `"${id}"`).join('; ');
      lines.push(`${indent}{rank=same; ${ids}}`);
    }
    for (let r = 0; r < rows.length - 1; r++) {
      lines.push(`${indent}"${rows[r][0]}" -> "${rows[r + 1][0]}" [style=invis]`);
    }
    return lines;
  }

  // (continued — external edge detection, DOT nodes/edges/notes assembly)

  // --- Groups with external edges (need larger cluster margin) ---

  const parentIdMap = new Map<string, string>();
  for (const g of model.groups || []) {
    for (const childId of g.children) parentIdMap.set(childId, g.id);
  }

  function getTopLevelAncestor(nodeId: string, targetParentId: string | undefined): string | undefined {
    let cur: string | undefined = nodeId;
    let prev: string | undefined = cur;
    while (cur) {
      if (parentIdMap.get(cur) === targetParentId) return cur;
      prev = cur;
      cur = parentIdMap.get(cur);
    }
    if (targetParentId === undefined) return prev;
    return undefined;
  }

  const groupsWithExternalEdge = new Set<string>();
  for (const g of model.groups || []) {
    for (const edge of model.edges) {
      const fromIsGroup = edge.from === g.id;
      const toIsGroup = edge.to === g.id;
      const fromIsPort = parentIdMap.get(edge.from) === g.id && renderers.get(edge.from)?.isPort;
      const toIsPort = parentIdMap.get(edge.to) === g.id && renderers.get(edge.to)?.isPort;
      const fromInG = fromIsGroup || fromIsPort;
      const toInG = toIsGroup || toIsPort;
      if (fromInG && !toInG) {
        if (getTopLevelAncestor(edge.to, g.parentId) !== undefined) {
          groupsWithExternalEdge.add(g.id);
          break;
        }
      } else if (!fromInG && toInG) {
        if (getTopLevelAncestor(edge.from, g.parentId) !== undefined) {
          groupsWithExternalEdge.add(g.id);
          break;
        }
      }
    }
  }

  // --- Build adapter context ---

  const smallFontSize = Math.round(theme.smallFontSize);
  const groupPadding = Math.round(theme.padXL);
  const groupSpacing = Math.round(theme.padS);

  const ctx: DotAdapterContext = {
    portNodes,
    groupsNeedingProxy,
    groupsWithExternalEdge,
    connectedNodes,
    renderers,
    groupById,
    buildRowPacking,
    maxRowWidth,
    nodesepPx,
    smallFontSize,
    fontSize: layoutFontSize,
    groupPadding,
    groupSpacing,
  };

  // --- Node + group DOT blocks (walk IR tree) ---

  const nodeGroupLines: string[] = [];
  for (const gn of rootNodes) {
    nodeGroupLines.push(...buildNodeDotLines(gn, '  ', ctx));
  }

  // --- Port node IDs (for spacer labels on unlabeled port edges) ---

  const portNodeIds = new Set<string>();
  for (const n of model.nodes) {
    if (n.isPort) portNodeIds.add(n.id);
  }

  // --- Edge lines ---

  const edgeLines: string[] = [];
  for (const edge of model.edges) {
    const dir = edge.direction || null;
    const isInverted = dir === 'left' || dir === 'up';
    const isHorizontal = dir === 'left' || dir === 'right';
    const isFromGroup = groupIds.has(edge.from);
    const isToGroup = groupIds.has(edge.to);
    const fromSpec = isFromGroup ? (groupRepNode.get(edge.from) || `"${edge.from}"`)
      : edge.fromPort ? `"${edge.from}":"${edge.fromPort}"` : `"${edge.from}"`;
    const toSpec = isToGroup ? (groupRepNode.get(edge.to) || `"${edge.to}"`)
      : edge.toPort ? `"${edge.to}":"${edge.toPort}"` : `"${edge.to}"`;

    let attrs = 'arrowtail=none,arrowhead=none';
    if (edge.label) {
      const dotLabel = unescapePlantUml(edge.label).replace(/"/g, '\\"');
      attrs += `,label="${dotLabel}"`;
    } else if (!edge.cardFrom && !edge.cardTo && (portNodeIds.has(edge.from) || portNodeIds.has(edge.to))) {
      // Invisible spacer label for unlabeled port edges to prevent cramped layout
      attrs += ',label=" "';
    }
    if (edge.cardFrom) {
      const escaped = unescapePlantUml(edge.cardFrom).replace(/"/g, '\\"');
      attrs += `,taillabel="${escaped}"`;
    }
    if (edge.cardTo) {
      const escaped = unescapePlantUml(edge.cardTo).replace(/"/g, '\\"');
      attrs += `,headlabel="${escaped}"`;
    }
    if (!isHorizontal) {
      const edgeLength = edge.length || 2;
      if (edgeLength > 1) {
        attrs += `,minlen=${edgeLength - 1}`;
      }
    }

    const dotFrom = isInverted ? toSpec : fromSpec;
    const dotTo = isInverted ? fromSpec : toSpec;
    edgeLines.push(`  ${dotFrom} -> ${dotTo} [${attrs}]`);
    if (isHorizontal) {
      const fromNodeId = isFromGroup ? (groupRepNode.get(edge.from) || `"${edge.from}"`) : `"${edge.from}"`;
      const toNodeId = isToGroup ? (groupRepNode.get(edge.to) || `"${edge.to}"`) : `"${edge.to}"`;
      edgeLines.push(`  {rank=same; ${fromNodeId}; ${toNodeId}}`);
    }
  }

  // --- Note + legend lines ---

  const notesByTargetPos = new Map<string, { id: string; position: string }[]>();
  for (const note of model.notes || []) {
    if (!note.target || !note.position) continue;
    const key = `${note.target}::${note.position.toLowerCase()}`;
    if (!notesByTargetPos.has(key)) notesByTargetPos.set(key, []);
    notesByTargetPos.get(key)!.push({ id: note.id, position: note.position.toLowerCase() });
  }

  const noteLines: string[] = [];
  for (const note of model.notes || []) {
    if (note.onLink) {
      const r = renderers.get(note.id);
      if (!r) continue;
      const sz = r.measure();
      noteLines.push(`  "${note.id}" [${buildNodeAttrs({ id: note.id, width: sz.width, height: sz.height }, false)}]`);
      if (note.linkEdgeId) {
        const linkedEdge = model.edges.find(e => e.id === note.linkEdgeId);
        if (linkedEdge) {
          noteLines.push(`  "${linkedEdge.from}" -> "${note.id}" [style=invis,weight=10]`);
          noteLines.push(`  "${note.id}" -> "${linkedEdge.to}" [style=invis,weight=10]`);
        }
      }
      continue;
    }
    const r = renderers.get(note.id);
    if (!r) continue;
    const sz = r.measure();
    noteLines.push(`  "${note.id}" [${buildNodeAttrs({ id: note.id, width: sz.width, height: sz.height }, false)}]`);
    if (note.target) {
      const pos = (note.position || '').toLowerCase();
      const key = `${note.target}::${pos}`;
      const group = notesByTargetPos.get(key);
      const groupIdx = group ? group.findIndex(g => g.id === note.id) : -1;
      const isFirst = groupIdx === 0;

      if (pos === 'left' || pos === 'right') {
        if (isFirst) {
          noteLines.push(`  { rank=same; "${note.id}"; "${note.target}" }`);
          if (pos === 'left') {
            noteLines.push(`  "${note.id}" -> "${note.target}" [style=invis]`);
          } else {
            noteLines.push(`  "${note.target}" -> "${note.id}" [style=invis]`);
          }
        } else {
          const prev = group![groupIdx - 1];
          noteLines.push(`  "${prev.id}" -> "${note.id}" [style=invis]`);
        }
      } else if (pos === 'top') {
        noteLines.push(`  "${note.id}" -> "${note.target}" [style=invis]`);
      } else if (pos === 'bottom') {
        noteLines.push(`  "${note.target}" -> "${note.id}" [style=invis]`);
      } else {
        noteLines.push(`  "${note.id}" -> "${note.target}" [style=invis]`);
      }
    }
  }

  // Legend node
  if (model.legend) {
    const legendR = renderers.get('__legend__');
    if (legendR) {
      const lsz = legendR.measure();
      noteLines.push(`  "__legend__" [${buildNodeAttrs({ id: '__legend__', width: lsz.width, height: lsz.height }, false)}]`);
      noteLines.push(`  { rank=sink; "__legend__"; }`);
    }
  }

  // --- Row packing for top-level leaf nodes ---

  const topLeafIds = rootNodes
    .filter(gn => !gn.children || gn.children.length === 0)
    .map(gn => gn.id);
  const rankLines = buildRowPacking(topLeafIds, '  ');

  // --- Detect swimlane diagrams ---
  const hasSwimlanes = (model.groups || []).some(
    g => g.type === 'swimlane_container' && g.concurrentRegions && g.concurrentRegions.length > 1
  );

  // --- Assemble DOT string ---

  const dotStr = `digraph G {
  rankdir=${rankdir}
  nodesep=${nodesepInch}
  ranksep=${ranksepInch}
  remincross=true
  searchsize=500${hasSwimlanes ? '\n  newrank=true' : ''}
  edge [fontsize=${layoutFontSize},labelfontsize=${layoutFontSize}]
  node [fontsize=${layoutFontSize},height=${dotMinH},width=${dotMinW}]
${nodeGroupLines.join('\n')}
${edgeLines.join('\n')}
${noteLines.join('\n')}
${rankLines.join('\n')}
}`;

  if ((globalThis as any).__DOT_DEBUG__) console.log(dotStr);
  return { dot: dotStr, groupIds };
}
