/**
 * Activity diagram parser — converts PEG-parsed statements into a SemanticModel
 * suitable for DOT/ELK layout and DrawIO XML generation.
 *
 * The parser walks statements sequentially, maintaining a "current node" cursor.
 * Control flow (if/while/repeat/fork/switch/split) creates branching structure.
 * Swimlanes and partitions map to SemanticGroups.
 *
 * Node types used:
 *   - 'class' with stereotype 'activity'       → rounded rectangle (action)
 *   - 'state_start'                            → filled circle (start)
 *   - 'state_end'                              → bullseye circle (stop)
 *   - 'state_fork'                             → fork/join bar
 *   - 'state_choice'                           → diamond (decision/merge)
 */

import { DiagramType, NodeType, EdgeType } from '../model/index.ts';
import type { SemanticModel, SemanticGroup, SemanticNode, SemanticEdge, ClassNote } from '../model/class-model.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let idCounter = 0;
function nextId(prefix: string): string {
  return `${prefix}_${++idCounter}`;
}

function resetIds(): void {
  idCounter = 0;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ActivityParseOptions {
  pragmas?: Record<string, string>;
}

export function parseActivityDiagram(
  statements: any[],
  options: ActivityParseOptions = {},
): SemanticModel {
  resetIds();

  const nodes: SemanticNode[] = [];
  const edges: SemanticEdge[] = [];
  const notes: ClassNote[] = [];
  const groups: SemanticGroup[] = [];
  const nodesById: Record<string, SemanticNode> = Object.create(null);
  const skinparams: Record<string, string> = {};
  let title: string | undefined;
  let edgeCount = 0;
  let rankdir: 'TB' | 'LR' = 'TB';

  // Current execution cursor — the node(s) from which the next activity continues.
  // Multiple cursors arise after if/else branches before merge.
  let cursors: string[] = [];

  // Swimlane tracking
  let currentSwimlane: SemanticGroup | null = null;
  const swimlaneMap = new Map<string, SemanticGroup>();
  let swimlaneCounter = 0;

  // Partition/group stack
  const groupStack: SemanticGroup[] = [];
  let groupCounter = 0;

  // Label/goto support
  const labelMap = new Map<string, string>(); // label name → node id
  const pendingLabels: string[] = []; // labels waiting to be assigned to next node

  // Arrow styling for next edge
  let pendingArrowColor: string | null = null;
  let pendingArrowLabel: string | null = null;
  let pendingArrowStyle: string | null = null;

  // Multi-line activity accumulator
  let activityAccum: { lines: string[]; color?: string } | null = null;

  // ---------------------------------------------------------------------------
  // Node creation
  // ---------------------------------------------------------------------------

  function addNode(node: SemanticNode): void {
    if (nodesById[node.id]) return;
    nodesById[node.id] = node;
    nodes.push(node);
    // Register in current group
    const group = currentSwimlane || (groupStack.length > 0 ? groupStack[groupStack.length - 1] : null);
    if (group && !group.children.includes(node.id)) {
      group.children.push(node.id);
    }
    // Consume pending labels — associate them with this node
    while (pendingLabels.length > 0) {
      labelMap.set(pendingLabels.pop()!, node.id);
    }
  }

  // SDL stereotypes → registered renderer names
  const sdlToRenderer: Record<string, string> = {
    'load': 'load', 'save': 'save',
    'input': 'input', 'output': 'output',
    'procedure': 'predefined-process', 'continuous': 'continuous',
    'task': 'rectangle',
  };

  function createActionNode(label: string, color?: string | null, sdlStereotype?: string | null): string {
    const id = nextId('act');
    // Determine renderer stereotype from SDL stereotype
    const rendererStereotype = sdlStereotype ? (sdlToRenderer[sdlStereotype.toLowerCase()] || 'activity') : 'activity';
    const node: SemanticNode = {
      id,
      type: NodeType.Class as any,
      label,
      stereotype: rendererStereotype,
      bodyLines: [],
    };
    // Apply inline color, or fall back to skinparam activityBackgroundColor/BorderColor
    const fill = color || skinparams.activityBackgroundColor || null;
    const stroke = skinparams.activityBorderColor || null;
    const styleParts: string[] = [];
    if (fill) styleParts.push(`back:${fill}`);
    if (!color && stroke) styleParts.push(`line:${stroke}`);
    if (styleParts.length) node.style = '#' + styleParts.join(';');
    addNode(node);
    return id;
  }

  function createStartNode(): string {
    const id = nextId('start');
    addNode({
      id,
      type: NodeType.StateStart as any,
      label: '',
      stereotype: null,
      bodyLines: [],
    });
    return id;
  }

  function createStopNode(): string {
    const id = nextId('stop');
    addNode({
      id,
      type: NodeType.StateEnd as any,
      label: '',
      stereotype: null,
      bodyLines: [],
    });
    return id;
  }

  function createEndNode(): string {
    // 'end' uses a flow final node (circle with X cross)
    const id = nextId('end');
    addNode({
      id,
      type: NodeType.StateFlowFinal as any,
      label: '',
      stereotype: null,
      bodyLines: [],
    });
    return id;
  }

  function createForkBar(): string {
    const id = nextId('fork');
    addNode({
      id,
      type: NodeType.StateFork as any,
      label: '',
      stereotype: null,
      bodyLines: [],
    });
    return id;
  }

  function createDiamond(label: string): string {
    const id = nextId('diamond');
    const fill = skinparams.activityDiamondBackgroundColor || null;
    const stroke = skinparams.activityDiamondBorderColor || null;
    const styleParts: string[] = [];
    if (fill) styleParts.push(`back:${fill}`);
    if (stroke) styleParts.push(`line:${stroke}`);
    const node: SemanticNode = {
      id,
      type: NodeType.StateChoice as any,
      label,
      stereotype: null,
      bodyLines: [],
    };
    if (styleParts.length) node.style = '#' + styleParts.join(';');
    addNode(node);
    return id;
  }

  function createMergeDiamond(): string {
    return createDiamond('');
  }

  // ---------------------------------------------------------------------------
  // Edge creation
  // ---------------------------------------------------------------------------

  function addEdge(from: string, to: string, label?: string, opts?: { style?: string | null; bracketColor?: string | null }): void {
    if (!from || !to) return;
    edgeCount++;
    const edge: SemanticEdge = {
      id: `e${edgeCount}`,
      type: EdgeType.Association as any,
      from,
      to,
      label: label || '',
      arrow: '-->',
    };
    if (opts?.style) edge.style = opts.style;
    if (opts?.bracketColor) edge.arrowMeta = { color: opts.bracketColor } as any;
    edges.push(edge);
  }

  function connectCursorsTo(targetId: string, label?: string): void {
    const arrowLabel = label || pendingArrowLabel || '';
    const color = pendingArrowColor || null;
    const style = pendingArrowStyle || null;
    for (const c of cursors) {
      addEdge(c, targetId, arrowLabel, { style, bracketColor: color });
    }
    pendingArrowColor = null;
    pendingArrowLabel = null;
    pendingArrowStyle = null;
  }

  // ---------------------------------------------------------------------------
  // Swimlane management
  // ---------------------------------------------------------------------------

  function switchSwimlane(name: string, color?: string | null, label?: string | null): void {
    if (swimlaneMap.has(name)) {
      currentSwimlane = swimlaneMap.get(name)!;
      return;
    }
    swimlaneCounter++;
    const id = `swim_${swimlaneCounter}`;
    const group: SemanticGroup = {
      id,
      label: label || name,
      type: 'rectangle',
      stereotype: '',
      children: [],
      childGroups: [],
    };
    if (color) group.color = color;
    groups.push(group);
    swimlaneMap.set(name, group);
    currentSwimlane = group;
  }

  // ---------------------------------------------------------------------------
  // Partition/group management
  // ---------------------------------------------------------------------------

  function pushPartition(label: string, color?: string | null, groupType?: string): void {
    groupCounter++;
    const parentId = currentSwimlane?.id || (groupStack.length > 0 ? groupStack[groupStack.length - 1].id : undefined);
    const id = `group_${groupCounter}`;
    const group: SemanticGroup = {
      id,
      label,
      type: groupType || 'frame',
      stereotype: '',
      parentId,
      children: [],
      childGroups: [],
    };
    if (color) group.color = color;
    groups.push(group);
    if (parentId) {
      const parent = groups.find(g => g.id === parentId);
      if (parent) parent.childGroups.push(id);
    }
    groupStack.push(group);
  }

  function popPartition(): void {
    groupStack.pop();
  }

  // ---------------------------------------------------------------------------
  // Flush multi-line activity
  // ---------------------------------------------------------------------------

  function flushActivity(): void {
    if (!activityAccum) return;
    const label = activityAccum.lines.join('\n');
    const nodeId = createActionNode(label, activityAccum.color);
    connectCursorsTo(nodeId);
    cursors = [nodeId];
    activityAccum = null;
  }

  // ---------------------------------------------------------------------------
  // Control flow context stack
  // ---------------------------------------------------------------------------

  interface IfContext {
    type: 'if';
    diamondId: string;
    branchEnds: string[][]; // end cursors from each branch
    branchLabels: (string | null)[];
    branchColors: (string | null)[];
    elseSeen: boolean;
    swimlane: SemanticGroup | null; // swimlane at if-start, restored at endif
  }

  interface BreakPoint {
    cursor: string;  // node id at break site
    label: string;   // pending arrow label at break time
  }

  interface WhileContext {
    type: 'while';
    condId: string; // diamond at loop head
    yesLabel: string;
    noLabel: string;
    backwardLabel: string;
    breakPoints: BreakPoint[];
  }

  interface RepeatContext {
    type: 'repeat';
    startId: string; // node at repeat start (junction for backward)
    backwardLabel: string;
    breakPoints: BreakPoint[];
  }

  interface ForkContext {
    type: 'fork';
    forkBarId: string;
    branchEnds: string[][];
    branchLabels: (string | null)[];
    branchColors: (string | null)[];
    keyword: string; // 'fork' or 'split'
  }

  interface SwitchContext {
    type: 'switch';
    diamondId: string;
    branchEnds: string[][];
  }

  type ControlContext = IfContext | WhileContext | RepeatContext | ForkContext | SwitchContext;
  const controlStack: ControlContext[] = [];

  // ---------------------------------------------------------------------------
  // Statement processing
  // ---------------------------------------------------------------------------

  for (let i = 0; i < statements.length; i++) {
    const st = statements[i];
    if (!st || typeof st !== 'object') continue;

    const kind = st.kind || '';
    const type = st.type || '';
    const rawText = String(st.text || '').toLowerCase();

    // Skip blanks and comments
    if (kind === 'blank_line' || kind === 'comment_line') continue;

    // Flush multi-line activity when we see a non-text line
    if (kind !== 'activity_text_line' && activityAccum) {
      flushActivity();
    }

    // ── Skinparam ──
    if (kind === 'directive_statement' && String(st.keyword || '').toLowerCase() === 'skinparam') {
      if (st.key && st.value) skinparams[st.key] = st.value;
      if (st.block === true) {
        // Block form: `skinparam activity { ... }` — collect child style_text_lines
        const prefix = String(st.text || '').trim();
        for (let j = i + 1; j < statements.length; j++) {
          const child = statements[j];
          if (!child) continue;
          if (child.kind === 'block_statement' && child.type === 'style_block_end') { i = j; break; }
          if (child.kind === 'style_text_line') {
            const line = String(child.text || '').trim();
            const m = line.match(/^(\w+)\s+(.+)$/);
            if (m) skinparams[(prefix ? prefix + m[1] : m[1])] = m[2].trim();
          }
        }
      }
      continue;
    }

    // ── Title ──
    if (kind === 'markup_statement' && type === 'title_line') {
      title = st.text;
      continue;
    }

    // ── Swimlane ──
    if (kind === 'block_statement' && type === 'swimlane') {
      flushActivity();
      switchSwimlane(st.name, st.color, st.label);
      continue;
    }

    // ── Partition ──
    if (kind === 'block_statement' && type === 'partition') {
      flushActivity();
      const text = String(st.text || '').trim();
      const cleaned = text.replace(/\s*\{?\s*$/, '').trim();
      // Color may appear before or after label: "partition #color Label" or "partition Label #color"
      const colorBefore = cleaned.match(/^(#\S+)\s+(.+)$/);
      const colorAfter = cleaned.match(/^(.+?)\s+(#\S+)$/);
      let rawLabel: string;
      let color: string | undefined;
      if (colorBefore) {
        color = colorBefore[1];
        rawLabel = colorBefore[2];
      } else if (colorAfter) {
        rawLabel = colorAfter[1];
        color = colorAfter[2];
      } else {
        rawLabel = cleaned;
      }
      const label = rawLabel.replace(/^"|"$/g, '').replace(/"/g, '').trim();
      pushPartition(label, color);
      continue;
    }

    // ── Group block start (group with {) ──
    if (kind === 'block_statement' && type === 'group' && st.block) {
      flushActivity();
      const label = String(st.text || '').replace(/^"|"$/g, '').trim();
      pushPartition(label);
      continue;
    }

    // ── Group start/end (without braces: "group label" / "end group") ──
    if (kind === 'block_statement' && type === 'group' && !st.block) {
      flushActivity();
      const rawT = String(st.raw || '');
      if (/^\s*end\s+group/i.test(rawT)) {
        if (groupStack.length > 0) popPartition();
      } else {
        const label = String(st.text || '').replace(/^"|"$/g, '').trim();
        pushPartition(label);
      }
      continue;
    }

    // ── Container block start (package/rectangle/card/... with {) ──
    if (kind === 'component_statement' && st.block) {
      flushActivity();
      const compType = String(st.componentType || '');
      const label = String(st.name || '').replace(/^"|"+$/g, '').trim();
      const color = st.color || null;
      // Pass componentType directly — resolveGroupShape() in rendering layer
      // resolves shape via renderer registry (hasRenderer).
      pushPartition(label, color, compType || undefined);
      continue;
    }

    // ── Block end (}) ──
    if (kind === 'block_statement' && (type === 'style_block_end' || rawText === '}')) {
      flushActivity();
      if (groupStack.length > 0) popPartition();
      continue;
    }

    // ── Start ──
    if (kind === 'control_statement' && rawText === 'start') {
      const id = createStartNode();
      if (cursors.length > 0) connectCursorsTo(id);
      cursors = [id];
      continue;
    }

    // ── Stop ──
    if (kind === 'control_statement' && rawText === 'stop') {
      const id = createStopNode();
      connectCursorsTo(id);
      cursors = [];
      continue;
    }

    // ── End ──
    if (kind === 'control_statement' && rawText === 'end') {
      const id = createEndNode();
      connectCursorsTo(id);
      cursors = [];
      continue;
    }

    // ── Kill / Detach ──
    if (kind === 'control_statement' && (rawText === 'kill' || rawText === 'detach')) {
      // When kill follows end split/fork, the last branch is detached from
      // the join bar and the join bar remains as cursor (PlantUML behaviour).
      if (cursors.length === 1) {
        const cNode = nodes.find(n => n.id === cursors[0]);
        const isJoinBar = cNode && (cNode.type as any) === NodeType.StateFork &&
          !controlStack.some(ctx => (ctx as any).forkBarId === cursors[0]);
        if (isJoinBar) {
          const joinId = cursors[0];
          // Remove the last edge pointing to this join bar
          for (let ei = edges.length - 1; ei >= 0; ei--) {
            if (edges[ei].to === joinId) {
              edges.splice(ei, 1);
              break;
            }
          }
          pendingArrowLabel = null;
          pendingArrowColor = null;
          continue;
        }
      }
      // Terminate current flow — clear cursors and pending arrow state
      // Exception: when inside an if‐branch and the cursor is a merge diamond
      // from a just‐closed inner if/elseif (has multiple incoming edges),
      // PlantUML's InstructionIf.kill() early‐returns without actually killing
      // the surviving branches.  We replicate that: treat kill as no‐op for the
      // merge diamond, so the outer endif still sees a surviving branch.
      if (cursors.length === 1 && controlStack.length > 0 && controlStack[controlStack.length - 1].type === 'if') {
        const inCount = edges.filter(e => e.to === cursors[0]).length;
        if (inCount > 1) {
          // Merge diamond from inner if/elseif — kill is no-op
          pendingArrowLabel = null;
          pendingArrowColor = null;
          continue;
        }
      }
      cursors = [];
      pendingArrowLabel = null;
      pendingArrowColor = null;
      continue;
    }

    // ── Break ──
    if (kind === 'control_statement' && rawText === 'break') {
      // Find nearest while/repeat context and save break cursors
      for (let si = controlStack.length - 1; si >= 0; si--) {
        const ctx = controlStack[si];
        if (ctx.type === 'while' || ctx.type === 'repeat') {
          const label = pendingArrowLabel || '';
          for (const c of cursors) {
            ctx.breakPoints.push({ cursor: c, label });
          }
          break;
        }
      }
      cursors = [];
      pendingArrowLabel = null;
      continue;
    }

    // ── mxgraph icon declaration ──
    // e.g. mxgraph.aws4.lambda_function "Process Order" as proc
    if (kind === 'generic_statement' && type === 'mxgraph_icon') {
      const shapeKey = String(st.shapeKey || '').trim();
      const rawLabel = String(st.label || '').trim();
      const rawColor = String(st.color || '').trim() || null;
      const label = rawLabel || shapeKey;
      const nodeId = nextId('act');
      const node: SemanticNode = {
        id: nodeId,
        type: NodeType.Class as any,
        label,
        stereotype: shapeKey,
        stereotypeLabel: '',
        bodyLines: [],
      };
      if (rawColor) node.style = rawColor;
      addNode(node);
      connectCursorsTo(nodeId);
      cursors = [nodeId];
      continue;
    }

    // ── Activity (single-line terminated) ──
    if (kind === 'activity_statement' && st.terminated === true) {
      const label = String(st.text || '');
      const nodeId = createActionNode(label, st.color, st.stereotype || null);
      connectCursorsTo(nodeId);
      cursors = [nodeId];
      continue;
    }

    // ── Activity (multi-line start) ──
    if (kind === 'activity_statement' && st.terminated === false && !st.continuation) {
      activityAccum = { lines: [String(st.text || '')], color: st.color };
      continue;
    }

    // ── Activity text line (continuation of multi-line) ──
    if (kind === 'activity_text_line') {
      if (activityAccum) {
        let line = String(st.text || '');
        // Remove trailing ';' from last line
        if (line.endsWith(';')) line = line.slice(0, -1);
        activityAccum.lines.push(line.trim());
      }
      continue;
    }

    // ── Activity continuation (line ending with ;) ──
    if (kind === 'activity_statement' && st.continuation === true) {
      const label = String(st.text || '');
      const nodeId = createActionNode(label, st.color);
      connectCursorsTo(nodeId);
      cursors = [nodeId];
      continue;
    }

    // ── Colored activity ──
    if (kind === 'activity_statement' && st.color) {
      const label = String(st.text || '');
      const nodeId = createActionNode(label, st.color);
      connectCursorsTo(nodeId);
      cursors = [nodeId];
      continue;
    }

    // ── Colored activity via declaration_statement (#color:text;) ──
    if (kind === 'declaration_statement' && st.visibility === '#') {
      const raw = String(st.text || '');
      // Parse "color:text;" pattern
      const m = raw.match(/^(\w+):(.+?)(?:;)?$/);
      if (m) {
        const color = '#' + m[1];
        const label = m[2].trim();
        const nodeId = createActionNode(label, color);
        connectCursorsTo(nodeId);
        cursors = [nodeId];
        continue;
      }
    }

    // ── Arrow styling ──
    if (kind === 'control_statement' && type === 'arrow') {
      pendingArrowColor = st.color || null;
      const text = String(st.text || '').trim();
      if (text && !text.endsWith(';')) {
        pendingArrowLabel = text;
      } else if (text) {
        pendingArrowLabel = text.replace(/;$/, '').trim();
      }
      continue;
    }

    // ── Link color ──
    if (kind === 'control_statement' && type === 'link') {
      pendingArrowColor = st.color || null;
      continue;
    }

    // ── If ──
    if (kind === 'control_statement' && type === 'if') {
      const cond = String(st.cond || '');
      const diamondId = createDiamond(cond);
      connectCursorsTo(diamondId);
      cursors = [diamondId];

      controlStack.push({
        type: 'if',
        diamondId,
        branchEnds: [],
        branchLabels: [],
        branchColors: [],
        elseSeen: false,
        swimlane: currentSwimlane,
      });

      // Start 'then' branch with label
      const branchLabel = st.branch || 'yes';
      pendingArrowLabel = branchLabel;
      continue;
    }

    // ── ElseIf ──
    if (kind === 'control_statement' && type === 'elseif') {
      const ctx = controlStack[controlStack.length - 1];
      if (ctx && ctx.type === 'if') {
        // Save current branch endpoint
        ctx.branchEnds.push([...cursors]);
        ctx.branchLabels.push(pendingArrowLabel);
        ctx.branchColors.push(pendingArrowColor);
        pendingArrowLabel = null;
        pendingArrowColor = null;
        // Create new diamond for elseif
        const cond = String(st.cond || '');
        const diamondId = createDiamond(cond);
        // Previous diamond's else branch → this diamond
        const prevLabel = st.lineBranch || 'no';
        addEdge(ctx.diamondId, diamondId, prevLabel);
        ctx.diamondId = diamondId;
        cursors = [diamondId];
        // Start branch
        pendingArrowLabel = st.branch || 'yes';
      }
      continue;
    }

    // ── Else ──
    if (kind === 'control_statement' && type === 'else') {
      const ctx = controlStack[controlStack.length - 1];
      if (ctx && ctx.type === 'if') {
        // Save current branch endpoint
        ctx.branchEnds.push([...cursors]);
        ctx.branchLabels.push(pendingArrowLabel);
        ctx.branchColors.push(pendingArrowColor);
        pendingArrowLabel = null;
        pendingArrowColor = null;
        ctx.elseSeen = true;
        // Else branch starts from the last diamond
        cursors = [ctx.diamondId];
        pendingArrowLabel = st.branch || st.lineBranch || 'no';
      }
      continue;
    }

    // ── Sequence block else (fallback from SequenceKeywordLine) ──
    if (kind === 'block_statement' && type === 'sequence_block' &&
        String(st.keyword || '').toLowerCase() === 'else') {
      const ctx = controlStack[controlStack.length - 1];
      if (ctx && ctx.type === 'if') {
        ctx.branchEnds.push([...cursors]);
        ctx.branchLabels.push(pendingArrowLabel);
        ctx.branchColors.push(pendingArrowColor);
        pendingArrowLabel = null;
        pendingArrowColor = null;
        ctx.elseSeen = true;
        cursors = [ctx.diamondId];
        const branchText = String(st.text || '').replace(/^\(/, '').replace(/\)$/, '').trim();
        pendingArrowLabel = branchText || 'no';
      }
      continue;
    }

    // ── Endif ──
    if ((kind === 'control_statement' && (type === 'endif' || rawText === 'endif'))) {
      const ctx = controlStack.pop();
      if (ctx && ctx.type === 'if') {
        // Collect all branch ends
        ctx.branchEnds.push([...cursors]);
        ctx.branchLabels.push(pendingArrowLabel);
        ctx.branchColors.push(pendingArrowColor);
        pendingArrowLabel = null;
        pendingArrowColor = null;
        if (!ctx.elseSeen) {
          // Implicit else: direct edge from last diamond
          ctx.branchEnds.push([ctx.diamondId]);
          ctx.branchLabels.push(null);
          ctx.branchColors.push(null);
        }
        const allEnds = ctx.branchEnds.flat().filter(c => c);
        if (allEnds.length > 1) {
          // Create merge diamond in the swimlane where the if started
          const savedSwimlane = currentSwimlane;
          currentSwimlane = ctx.swimlane;
          const mergeId = createMergeDiamond();
          currentSwimlane = savedSwimlane;
          for (let i = 0; i < ctx.branchEnds.length; i++) {
            const lbl = ctx.branchLabels[i] || '';
            const clr = ctx.branchColors[i] || null;
            for (const c of ctx.branchEnds[i]) {
              if (c) addEdge(c, mergeId, lbl, { bracketColor: clr });
            }
          }
          cursors = [mergeId];
        } else if (allEnds.length === 1) {
          // Restore pending state from the surviving branch
          const idx = ctx.branchEnds.findIndex(ends => ends.length > 0);
          if (idx >= 0) {
            pendingArrowLabel = ctx.branchLabels[idx];
            pendingArrowColor = ctx.branchColors[idx];
          }
          cursors = allEnds;
        } else {
          cursors = [];
        }
      }
      continue;
    }

    // ── While ──
    if (kind === 'control_statement' && type === 'while') {
      const kw = String(st.keyword || '').toLowerCase();
      if (kw === 'while' || kw === '') {
        const text = String(st.text || '');
        // Parse condition and is-label from text: "(cond) is (label)"
        const condMatch = text.match(/^\(([^)]*)\)(?:\s+is\s+\(([^)]*)\))?/i);
        const cond = condMatch ? condMatch[1] : text;
        const yesLabel = condMatch && condMatch[2] ? condMatch[2] : 'yes';
        const diamondId = createDiamond(cond);
        connectCursorsTo(diamondId);
        cursors = [diamondId];
        pendingArrowLabel = yesLabel;
        controlStack.push({
          type: 'while',
          condId: diamondId,
          yesLabel,
          noLabel: '',
          backwardLabel: '',
          breakPoints: [],
        });
      } else if (kw === 'endwhile') {
        const text = String(st.text || '');
        const outMatch = text.match(/^\(([^)]*)\)/);
        const noLabel = outMatch ? outMatch[1] : 'no';
        const ctx = controlStack.pop();
        if (ctx && ctx.type === 'while') {
          // Loop back edge: current → diamond (via backward node if present)
          if (ctx.backwardLabel) {
            const bwId = createActionNode(ctx.backwardLabel);
            for (const c of cursors) { addEdge(c, bwId); }
            addEdge(bwId, ctx.condId);
          } else {
            for (const c of cursors) { addEdge(c, ctx.condId); }
          }

          if (ctx.breakPoints.length > 0) {
            // Create merge junction for break exits + normal while exit
            const mergeId = createMergeDiamond();
            addEdge(ctx.condId, mergeId, noLabel);
            for (const bp of ctx.breakPoints) {
              addEdge(bp.cursor, mergeId, bp.label);
            }
            cursors = [mergeId];
          } else {
            // No break — normal exit from diamond
            cursors = [ctx.condId];
            pendingArrowLabel = noLabel;
          }
        }
      }
      continue;
    }

    // ── Repeat ──
    if (kind === 'control_statement' && type === 'repeat') {
      const kw = String(st.keyword || '').toLowerCase();
      if (kw === 'repeat') {
        // repeat start — create a junction node as loop entry
        const junctionId = createMergeDiamond();
        connectCursorsTo(junctionId);
        cursors = [junctionId];
        controlStack.push({
          type: 'repeat',
          startId: junctionId,
          backwardLabel: '',
          breakPoints: [],
        });
        // If repeat has a label ":text;", create an action node
        const text = String(st.text || '').trim();
        if (text) {
          const labelMatch = text.match(/^:(.+);?$/);
          if (labelMatch) {
            const nodeId = createActionNode(labelMatch[1].replace(/;$/, ''));
            connectCursorsTo(nodeId);
            cursors = [nodeId];
          }
        }
      } else if (kw === 'repeat while') {
        const text = String(st.text || '');
        // Parse: "(cond)" or "(cond) is (yes)" or "(cond) is (yes) not (no)"
        const m = text.match(/^\(([^)]*)\)(?:\s+is\s+\(([^)]*)\))?(?:\s+not\s+\(([^)]*)\))?/i);
        const cond = m ? m[1] : text;
        const yesLabel = m && m[2] ? m[2] : 'yes';
        const noLabel = m && m[3] ? m[3] : 'no';
        const ctx = controlStack.pop();
        if (ctx && ctx.type === 'repeat') {
          // Create condition diamond at bottom
          const diamondId = createDiamond(cond);
          connectCursorsTo(diamondId);
          // Loop back: diamond → start (via backward action node if present)
          if (ctx.backwardLabel) {
            const bwId = createActionNode(ctx.backwardLabel);
            addEdge(diamondId, bwId, yesLabel);
            addEdge(bwId, ctx.startId);
          } else {
            addEdge(diamondId, ctx.startId, yesLabel);
          }
          // Exit
          if (ctx.breakPoints.length > 0) {
            // Create merge junction for break exits + normal repeat exit
            const mergeId = createMergeDiamond();
            addEdge(diamondId, mergeId, noLabel);
            for (const bp of ctx.breakPoints) {
              addEdge(bp.cursor, mergeId, bp.label);
            }
            cursors = [mergeId];
          } else {
            cursors = [diamondId];
            pendingArrowLabel = noLabel;
          }
        }
      }
      continue;
    }

    // ── Backward (inside repeat or while) ──
    if (kind === 'control_statement' && type === 'backward') {
      const ctx = controlStack[controlStack.length - 1];
      if (ctx && (ctx.type === 'repeat' || ctx.type === 'while')) {
        const text = String(st.text || '').trim().replace(/^:/, '').replace(/;$/, '');
        if (text) ctx.backwardLabel = text;
      }
      continue;
    }

    // ── Fork / Split ──
    if (kind === 'control_statement' && type === 'fork') {
      const kw = String(st.keyword || '').toLowerCase();
      if (kw === 'fork') {
        const barId = createForkBar();
        connectCursorsTo(barId);
        cursors = [barId];
        controlStack.push({
          type: 'fork',
          forkBarId: barId,
          branchEnds: [],
          branchLabels: [],
          branchColors: [],
          keyword: 'fork',
        });
      } else if (kw === 'fork again') {
        const ctx = controlStack[controlStack.length - 1];
        if (ctx && ctx.type === 'fork') {
          ctx.branchEnds.push([...cursors]);
          ctx.branchLabels.push(pendingArrowLabel);
          ctx.branchColors.push(pendingArrowColor);
          pendingArrowLabel = null;
          pendingArrowColor = null;
          cursors = [ctx.forkBarId];
        }
      } else if (kw === 'end fork') {
        const ctx = controlStack.pop();
        if (ctx && ctx.type === 'fork') {
          ctx.branchEnds.push([...cursors]);
          ctx.branchLabels.push(pendingArrowLabel);
          ctx.branchColors.push(pendingArrowColor);
          pendingArrowLabel = null;
          pendingArrowColor = null;
          const joinBarId = createForkBar();
          for (let i = 0; i < ctx.branchEnds.length; i++) {
            const lbl = ctx.branchLabels[i] || '';
            const clr = ctx.branchColors[i] || null;
            for (const c of ctx.branchEnds[i]) { addEdge(c, joinBarId, lbl, { bracketColor: clr }); }
          }
          cursors = [joinBarId];
        }
      } else if (kw === 'end merge') {
        const ctx = controlStack.pop();
        if (ctx && ctx.type === 'fork') {
          ctx.branchEnds.push([...cursors]);
          ctx.branchLabels.push(pendingArrowLabel);
          ctx.branchColors.push(pendingArrowColor);
          pendingArrowLabel = null;
          pendingArrowColor = null;
          // end merge: just merge to a single point (no join bar)
          const mergeId = createMergeDiamond();
          for (let i = 0; i < ctx.branchEnds.length; i++) {
            const lbl = ctx.branchLabels[i] || '';
            const clr = ctx.branchColors[i] || null;
            for (const c of ctx.branchEnds[i]) { addEdge(c, mergeId, lbl, { bracketColor: clr }); }
          }
          cursors = [mergeId];
        }
      }
      continue;
    }

    // ── Split ──
    if (kind === 'control_statement' && type === 'split') {
      const kw = String(st.keyword || '').toLowerCase();
      if (kw === 'split') {
        if (cursors.length > 0) {
          // Create a start bar when there's incoming flow
          const barId = createForkBar();
          connectCursorsTo(barId);
          cursors = [barId];
          controlStack.push({
            type: 'fork',
            forkBarId: barId,
            branchEnds: [],
            branchLabels: [],
            branchColors: [],
            keyword: 'split',
          });
        } else {
          // No incoming flow — no start bar
          controlStack.push({
            type: 'fork',
            forkBarId: '',
            branchEnds: [],
            branchLabels: [],
            branchColors: [],
            keyword: 'split',
          });
        }
      } else if (kw === 'split again') {
        const ctx = controlStack[controlStack.length - 1];
        if (ctx && ctx.type === 'fork' && ctx.keyword === 'split') {
          ctx.branchEnds.push([...cursors]);
          ctx.branchLabels.push(pendingArrowLabel);
          ctx.branchColors.push(pendingArrowColor);
          pendingArrowLabel = null;
          pendingArrowColor = null;
          cursors = [ctx.forkBarId];
        }
      } else if (kw === 'end split') {
        const ctx = controlStack.pop();
        if (ctx && ctx.type === 'fork' && ctx.keyword === 'split') {
          ctx.branchEnds.push([...cursors]);
          ctx.branchLabels.push(pendingArrowLabel);
          ctx.branchColors.push(pendingArrowColor);
          pendingArrowLabel = null;
          pendingArrowColor = null;
          const joinBarId = createForkBar();
          for (let i = 0; i < ctx.branchEnds.length; i++) {
            const lbl = ctx.branchLabels[i] || '';
            const clr = ctx.branchColors[i] || null;
            for (const c of ctx.branchEnds[i]) { addEdge(c, joinBarId, lbl, { bracketColor: clr }); }
          }
          cursors = [joinBarId];
        }
      }
      continue;
    }

    // ── Switch ──
    if (kind === 'control_statement' && type === 'switch') {
      const cond = String(st.cond || '');
      const diamondId = createDiamond(cond);
      connectCursorsTo(diamondId);
      cursors = [diamondId];
      controlStack.push({
        type: 'switch',
        diamondId,
        branchEnds: [],
      });
      continue;
    }

    // ── Case ──
    if (kind === 'control_statement' && type === 'case') {
      const ctx = controlStack[controlStack.length - 1];
      if (ctx && ctx.type === 'switch') {
        if (cursors[0] !== ctx.diamondId) {
          ctx.branchEnds.push([...cursors]);
        }
        cursors = [ctx.diamondId];
        const text = String(st.text || '').replace(/^\(/, '').replace(/\)$/, '').trim();
        pendingArrowLabel = text || '';
      }
      continue;
    }

    // ── EndSwitch ──
    if (kind === 'control_statement' && type === 'endswitch') {
      const ctx = controlStack.pop();
      if (ctx && ctx.type === 'switch') {
        ctx.branchEnds.push([...cursors]);
        const allEnds = ctx.branchEnds.flat().filter(c => c);
        if (allEnds.length > 1) {
          const mergeId = createMergeDiamond();
          for (const c of allEnds) { addEdge(c, mergeId); }
          cursors = [mergeId];
        } else if (allEnds.length === 1) {
          cursors = allEnds;
        }
      }
      continue;
    }

    // ── Note ──
    if (kind === 'note_start' || kind === 'note_statement') {
      // note_start text is merged by the pre-parser (puml.ts)
      const noteId = nextId('note');
      const position = st.dir || st.position || 'right';
      const lastCursor = cursors[cursors.length - 1];
      notes.push({
        id: noteId,
        text: String(st.text || ''),
        position,
        target: lastCursor || undefined,
      });
      continue;
    }

    // ── Note text / end note — skip (no longer emitted by pre-parser, kept as safety) ──
    if (kind === 'note_text_line' || kind === 'note_end') continue;

    // ── Label definition ──
    if (kind === 'component_statement' && st.componentType === 'label') {
      const name = String(st.name || '');
      // Create a merge diamond as the goto target
      const mergeId = createMergeDiamond();
      connectCursorsTo(mergeId);
      cursors = [mergeId];
      labelMap.set(name, mergeId);
      continue;
    }

    // ── Jump (goto) ──
    if (kind === 'jump_statement' && st.keyword === 'goto') {
      const target = String(st.target || '');
      const targetId = labelMap.get(target);
      if (targetId) {
        connectCursorsTo(targetId);
      }
      cursors = [];
      continue;
    }

    // ── Jump (other) ──
    if (kind === 'jump_statement') continue;

    // ── Bullet/list activity (* item / - item) ──
    if (kind === 'activity_statement' && st.bullet) {
      const label = String(st.text || '');
      const nodeId = createActionNode(label);
      connectCursorsTo(nodeId);
      cursors = [nodeId];
      continue;
    }

    // ── Dash-list activity (- item) parsed as declaration_statement ──
    if (kind === 'declaration_statement' && st.type === 'member') {
      flushActivity();
      const label = String(st.text || '');
      const nodeId = createActionNode(label);
      connectCursorsTo(nodeId);
      cursors = [nodeId];
      continue;
    }

    // ── Circle spot (A) ──
    if (kind === 'activity_statement' && st.paren) {
      const label = String(st.text || '');
      const nodeId = nextId('spot');
      addNode({
        id: nodeId,
        type: NodeType.Class as any,
        label,
        stereotype: 'circle',
        bodyLines: [],
      });
      connectCursorsTo(nodeId);
      cursors = [nodeId];
      continue;
    }

    // ── Direction ──
    if (kind === 'directive_statement') {
      const kw = String(st.keyword || '').toLowerCase();
      if (kw === 'left to right direction') rankdir = 'LR';
      else if (kw === 'top to bottom direction') rankdir = 'TB';
      continue;
    }
    if (kind === 'style_text_line') continue;

    // ── Unhandled statement — skip silently ──
  }

  // Flush any remaining multi-line activity
  flushActivity();

  // ---------------------------------------------------------------------------
  // Consolidate swimlanes into a single root group with concurrentRegions
  // ---------------------------------------------------------------------------
  if (swimlaneMap.size > 0) {
    const swimlaneGroups = Array.from(swimlaneMap.values());
    const swimlaneIds = new Set(swimlaneGroups.map(g => g.id));

    const rootGroup: SemanticGroup = {
      id: '__swimlanes__',
      label: '',
      type: 'swimlane_container',
      stereotype: '',
      children: [],
      childGroups: [],
      concurrentRegions: swimlaneGroups.map(g => [...g.children]),
      concurrentRegionLabels: swimlaneGroups.map(g => g.label),
      concurrentRegionColors: swimlaneGroups.map(g => g.color || ''),
    };

    // Flatten all swimlane children into root group's children
    for (const sg of swimlaneGroups) {
      rootGroup.children.push(...sg.children);
    }

    // Separate swimlane groups from non-swimlane groups (partitions etc.)
    const otherGroups = groups.filter(g => !swimlaneIds.has(g.id));

    // Reparent partition groups that were children of swimlane groups
    for (const g of otherGroups) {
      if (g.parentId && swimlaneIds.has(g.parentId)) {
        g.parentId = '__swimlanes__';
        rootGroup.childGroups.push(g.id);
      }
    }

    // Replace groups array with consolidated structure
    groups.length = 0;
    groups.push(rootGroup, ...otherGroups);
  }

  return {
    diagramType: DiagramType.UML,
    nodes,
    edges,
    notes,
    groups,
    title,
    rankdir,
    skinparams: Object.keys(skinparams).length > 0 ? skinparams : undefined,
  };
}
