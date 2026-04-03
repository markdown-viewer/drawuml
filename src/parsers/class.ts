import { DiagramType, NodeType, EdgeType } from '../model/index.ts';
import type { DiagramContext } from '../detect-context.ts';
import { DEPLOYMENT_COMPONENT_KEYWORDS } from '../detect-context.ts';
import type { SemanticGroup, SemanticModel } from '../model/index.ts';
import type { BodyLine, SemanticNode, SemanticEdge, ClassNote } from '../model/class-model.ts';
import { arrowToEdgeType, edgeStyleForArrow, normalizeArrowMeta } from './arrow.ts';
import {
  lookupArchimateElementMacro,
  lookupArchimateRelMacro,
  parseArchimateElementArgs,
  parseArchimateRelArgs,
  resolveArchimateLayerColor,
} from './archimate-macros.ts';
import {
  lookupC4ElementMacro,
  lookupC4BoundaryMacro,
  lookupC4RelMacro,
  parseC4ElementArgs,
  parseC4BoundaryArgs,
  parseC4RelArgs,
} from './c4-macros.ts';
import { lookupAwslibMacro, isKnownAwslibSprite } from './awslib-macros.ts';

// Legacy activity diagram logic is merged into parseClassDiagram via lazy detection.

interface ParseClassDiagramOptions {
  strict?: boolean;
  pragmas?: Record<string, string>;
  /** Diagram sub-context determined by dispatcher. Controls implicit node shapes. */
  diagramContext?: DiagramContext;
}



function normalizeId(name) {
  let s = String(name || '').trim();
  // Strip leading () for interface-old syntax: "()HTTP" → "HTTP"
  if (s.startsWith('()')) s = s.slice(2).trim();
  // Strip surrounding brackets for component shorthand: "[Component]" → "Component"
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1).trim();
  // Strip surrounding parentheses for use-case names: "(Use case)" → "Use case"
  if (s.startsWith('(') && s.endsWith(')')) s = s.slice(1, -1).trim();
  // Strip surrounding colons for actor names: ":Actor:" → "Actor"
  if (s.startsWith(':') && s.endsWith(':')) s = s.slice(1, -1).trim();
  return s;
}

/**
 * Detect node type from a raw relation endpoint name.
 * Returns { type, label, stereotype } or null if no pattern matched.
 */
function detectUsecaseEndpointType(rawEndpoint: string) {
  const s = String(rawEndpoint || '').trim();
  // Explicit syntax — always detected regardless of diagram context.
  // Exclude comma-separated (A, B) n-ary association diamond syntax.
  if (s.startsWith('(') && s.endsWith(')') && !s.includes(',')) {
    return { type: NodeType.Usecase, label: s.slice(1, -1).trim(), stereotype: 'usecase' };
  }
  if (s.startsWith(':') && s.endsWith(':')) {
    return { type: NodeType.UsecaseActor, label: s.slice(1, -1).trim(), stereotype: 'actor' };
  }
  // Bracket component shorthand: [Name] → component node
  if (s.startsWith('[') && s.endsWith(']')) {
    return { type: NodeType.Class, label: s.slice(1, -1).trim(), stereotype: 'component' };
  }
  return null;
}

/**
 * Resolve a note target reference.
 * PlantUML supports member-level targets like "A::counter" or "A::"start(int)"".
 * Returns { classId, memberTarget } where classId is the class-level id for
 * layout, and memberTarget is the full "Class::member" string (or undefined).
 */
function resolveNoteTarget(raw: string): { classId: string; memberTarget?: string } {
  const s = normalizeId(raw);
  const idx = s.indexOf('::');
  if (idx >= 0) {
    return { classId: s.slice(0, idx), memberTarget: s };
  }
  return { classId: s };
}

export function parseClassDiagram(statements: any[], options: ParseClassDiagramOptions = {}) {
  const strict = options.strict === true;
  const diagramContext: DiagramContext = options.diagramContext || 'class';
  const isStateDiagram = diagramContext === 'state';
  const isUsecaseContext = diagramContext === 'usecase';
  const isDeploymentContext = diagramContext === 'deployment';
  const isDescriptionContext = diagramContext === 'description';

  const nodesById = Object.create(null);
  const nodeOrder = [];
  const edges = [];
  const notes = [];
  const errors = [];
  const groups: SemanticGroup[] = [];
  const groupStack: SemanticGroup[] = [];  // stack for nested package/namespace blocks
  let groupCounter = 0;
  let useIntermediatePackages = options.pragmas?.useIntermediatePackages !== 'false';
  const blockPushCounts: number[] = [];  // how many groups each block-start pushed onto groupStack
  let rankdir = 'TB';  // default: top-to-bottom (left entity above right entity)
  let lastDefinedClass = '';  // tracks last class/entity for "note left: ..." shorthand
  let lastEdgeId = '';        // tracks last edge for "note on link" binding
  let legendBlock: { lines: string[]; align: string | null } | null = null;  // multi-line legend accumulator
  let legend: { text: string; align?: string } | null = null;
  let title: string | undefined;
  const skinparams: Record<string, string> = {};
  // Concurrent region counter per state group: tracks how many '--' separators
  // have been seen inside each state, used to generate unique [*] IDs per region.
  const concurrentRegionCounters: Record<string, number> = {};
  // Concurrent region break points per state group: records children.length
  // at each '--'/'||' separator so we can compute concurrentRegions later.
  const concurrentRegionBreaks: Record<string, number[]> = {};
  // CSS-like <style> block rules: selector → { BackGroundColor, LineColor, LineThickness }
  const cssStyleRules: Record<string, Record<string, string>> = {};
  let styleBlockAccum: { name: string; props: Record<string, string> } | null = null;
  // Ordered remove/restore directives.  Processed sequentially to decide per-node visibility.
  type RemoveRule = { action: 'remove' | 'restore'; target: string }; // target: '*' | '$tag' | normalized id
  const removeRules: RemoveRule[] = [];
  let namespaceSeparator: string | null = '.';  // default '.' — 'none' means no auto-grouping

  // ── Legacy activity diagram support (merged via lazy detection) ──────
  // Track chained arrows: remember the last target so chained arrows know their source
  let lastTarget: string | null = null;
  // Track if-else-endif branching
  const branchStack: { conditionNode: string; lastTargets: string[]; beforeIf: string | null }[] = [];
  // Count start/end occurrences for (*) disambiguation
  let starAsSourceCount = 0;
  let starAsTargetCount = 0;
  // Pending merge targets from if/else/endif resolution
  let pendingMergeTargets: string[] = [];

  // State-diagram stereotypes that map to port nodes (entry/exit points on group boundary)
  const PORT_STEREOTYPE_MAP: Record<string, 'portin' | 'portout'> = {
    entryPoint: 'portin',
    inputPin: 'portin',
    expansionInput: 'portin',
    exitPoint: 'portout',
    outputPin: 'portout',
    expansionOutput: 'portout',
  };

  // Lazy detection: diagram has legacy activity arrows
  const hasLegacyActivityContext = statements.some(st =>
    st && typeof st === 'object' &&
    st.kind === 'arrow_statement' && st.legacy === true
  );

  // ── Legacy activity helpers ─────────────────────────────────────────
  // Declarative mapping: PEG endpoint type → semantic node type
  const ENDPOINT_NODE_MAP: Record<string, string> = {
    start_end: NodeType.StateStart,
    sync_bar: NodeType.StateFork,
  };

  /** Ensure an activity node exists; node type resolved by PEG endpoint classification. */
  function ensureActivityNode(rawId: string, aliasId?: string | null, endpointType?: string): string {
    const id = aliasId || rawId;
    if (nodesById[id]) return id;

    const type = ENDPOINT_NODE_MAP[endpointType!] || (rawId === '(*)' ? NodeType.StateStart : NodeType.Class);
    const label = type === NodeType.Class ? rawId : '';

    // Only regular activity nodes get the 'activity' stereotype;
    // special nodes (fork bars, start/end) use their own renderers.
    nodesById[id] = {
      id,
      type: type as any,
      label,
      stereotype: type === NodeType.Class ? 'activity' : null,
      stereotypeLabel: '',
      bodyLines: [],
    };
    nodeOrder.push(id);
    registerNodeInGroup(id);
    return id;
  }

  /** Create a decision diamond node for if/else branching */
  function createDecisionNode(cond: string): string {
    const id = `__decision_${edges.length}__`;
    nodesById[id] = {
      id,
      type: NodeType.StateChoice as any,
      label: cond,
      stereotype: null,
      stereotypeLabel: '',
      bodyLines: [],
    };
    nodeOrder.push(id);
    registerNodeInGroup(id);
    return id;
  }

  /** Add a simple directed edge for legacy activity arrows */
  function addActivityEdge(from: string, to: string, label: string, arrowToken?: string) {
    const meta = arrowToken ? normalizeArrowMeta(null, arrowToken) : null;
    edges.push({
      id: `e${edges.length + 1}`,
      type: EdgeType.Association as any,
      from,
      to,
      label: label || '',
      arrow: arrowToken || '-->',
      arrowMeta: meta,
      style: null,
      direction: meta?.direction || null,
      length: meta?.length,
    });
  }

  // hide/show visibility rules collected from "hide ..."/"show ..." directives.
  // Each rule: { action, scope, aspect } where:
  //   action  = 'hide' | 'show'
  //   scope   = '*' | node-id | '<<Stereotype>>'
  //   aspect  = 'members' | 'fields' | 'methods' | 'circle'
  type VisRule = { action: 'hide' | 'show'; scope: string; aspect: string };
  const visRules: VisRule[] = [];

  /**
   * Compute the fully-qualified name for a group by walking up the parentId chain.
   * E.g. group "foo3" inside "foo2" inside "foo1" → "foo1.foo2.foo3".
   */
  function getGroupQualifiedName(g: SemanticGroup): string {
    if (g.parentId) {
      const parent = groups.find(p => p.id === g.parentId);
      if (parent) return getGroupQualifiedName(parent) + '.' + g.label;
    }
    return g.label;
  }

  /** Find a group whose fully-qualified name or alias equals the given name. */
  function findGroupByQualifiedName(name: string): SemanticGroup | undefined {
    return groups.find(g => g.alias === name || getGroupQualifiedName(g) === name);
  }

  /** Register a node id into the current group (if any package-type group). */
  function registerNodeInGroup(nodeId: string) {
    if (groupStack.length > 0) {
      const currentGroup = groupStack[groupStack.length - 1];
      if (!currentGroup.children.includes(nodeId)) {
        currentGroup.children.push(nodeId);
      }
    }
  }

  /** Build the current namespace prefix from namespace-type groups on the stack. */
  function getCurrentNamespacePrefix(): string {
    const parts: string[] = [];
    for (const g of groupStack) {
      if (g.type === 'namespace') parts.push(g.label);
    }
    return parts.join('.');
  }

  /** Resolve a raw name using current namespace context.
   *  - Leading '.' → root reference (strip dot)
   *  - Already contains dots → fully qualified (unchanged)
   *  - Otherwise → prepend current namespace prefix
   */
  function resolveNameInScope(rawName: string): { resolved: string; isRoot: boolean } {
    const prefix = getCurrentNamespacePrefix();
    if (!prefix) return { resolved: rawName, isRoot: false };
    if (rawName.startsWith('.')) return { resolved: rawName.slice(1), isRoot: true };
    if (rawName.includes('.')) return { resolved: rawName, isRoot: false };
    return { resolved: prefix + '.' + rawName, isRoot: false };
  }

  /**
   * Resolve a dotted target name (e.g. "foo.baz") to an existing node id.
   * If "foo.baz" doesn't exist as a node, check if "baz" is a child of a
   * group whose qualified name is "foo".
   */
  function resolveQualifiedTarget(target: string): string {
    if (nodesById[target]) return target;
    if (namespaceSeparator && target.includes(namespaceSeparator)) {
      const parts = target.split(namespaceSeparator);
      const leafName = parts[parts.length - 1];
      const groupName = parts.slice(0, -1).join(namespaceSeparator);
      if (nodesById[leafName]) {
        const group = findGroupByQualifiedName(groupName);
        if (group && group.children.includes(leafName)) {
          return leafName;
        }
      }
    }
    return target;
  }

  /**
   * Resolve history endpoint syntax: [H], [H*], Name[H], Name[H*].
   * Creates a state_history node in the appropriate group and returns its id.
   * Returns the original id unchanged if not a history endpoint.
   */
  function resolveHistoryEndpoint(rawName: string, resolvedId: string): string {
    // Match [H] or [H*] (standalone — history of current group)
    const standaloneMatch = /^\[H(\*?)\]$/i.exec(rawName);
    if (standaloneMatch) {
      const deep = standaloneMatch[1] === '*';
      const sg = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
      const prefix = sg ? sg.id : '';
      const histId = prefix ? `${prefix}.__history${deep ? '_deep' : ''}__` : `__history${deep ? '_deep' : ''}__`;
      if (!nodesById[histId]) {
        nodeOrder.push(histId);
        nodesById[histId] = {
          id: histId,
          type: NodeType.StateHistory,
          label: deep ? 'H*' : 'H',
          stereotype: null,
          stereotypeLabel: '',
          bodyLines: [],
        };
        registerNodeInGroup(histId);
      }
      return histId;
    }
    // Match Name[H] or Name[H*] (history of named group)
    const qualifiedMatch = /^(.+)\[H(\*?)\]$/i.exec(rawName);
    if (qualifiedMatch) {
      const groupName = qualifiedMatch[1];
      const deep = qualifiedMatch[2] === '*';
      // Find the target group by name
      const targetGroup = findGroupByQualifiedName(groupName);
      const prefix = targetGroup ? targetGroup.id : groupName;
      const histId = `${prefix}.__history${deep ? '_deep' : ''}__`;
      if (!nodesById[histId]) {
        nodeOrder.push(histId);
        nodesById[histId] = {
          id: histId,
          type: NodeType.StateHistory,
          label: deep ? 'H*' : 'H',
          stereotype: null,
          stereotypeLabel: '',
          bodyLines: [],
        };
        // Register inside the target group
        if (targetGroup) {
          if (!targetGroup.children.includes(histId)) {
            targetGroup.children.push(histId);
          }
        }
      }
      return histId;
    }
    return resolvedId;
  }

  /** Find an existing node whose short name (last dot-segment) matches.
   *  Returns the node id if exactly one match found, undefined otherwise. */
  function findExistingNodeByShortName(shortName: string): string | undefined {
    let found: string | undefined;
    for (const id of Object.keys(nodesById)) {
      const lastDot = id.lastIndexOf('.');
      const sn = lastDot >= 0 ? id.slice(lastDot + 1) : id;
      if (sn === shortName) {
        if (found) return undefined; // Multiple matches — ambiguous
        found = id;
      }
    }
    return found;
  }

  /**
   * Find or create a chain of nested groups for the given segments.
   * Reuses existing groups that match by label + parentId.
   * Returns the array of groups from outermost to innermost.
   */
  function findOrCreateGroupChain(segments: string[], type: string, startParent?: SemanticGroup, stereotype?: string): SemanticGroup[] {
    const chain: SemanticGroup[] = [];
    let currentParent: SemanticGroup | undefined = startParent;
    for (const seg of segments) {
      const parentId = currentParent?.id;
      const existing = groups.find(g => g.label === seg && g.parentId === parentId);
      if (existing) {
        chain.push(existing);
        currentParent = existing;
      } else {
        groupCounter++;
        const groupId = `group_${groupCounter}`;
        const group: SemanticGroup = {
          id: groupId,
          label: seg,
          type: type,
          ...(stereotype ? { stereotype } : {}),
          parentId: parentId,
          children: [],
          childGroups: [],
        };
        if (currentParent && !currentParent.childGroups.includes(groupId)) {
          currentParent.childGroups.push(groupId);
        }
        groups.push(group);
        chain.push(group);
        currentParent = group;
      }
    }
    return chain;
  }

  /**
   * Ensure a node is registered in the correct group based on its (resolved) id.
   * - Dotted names → auto-create intermediate packages from root
   * - Simple names → register in current group on the stack
   * - Root references (isRoot=true) → skip group registration
   */
  function ensureNodeInCorrectGroup(nodeId: string, isRoot: boolean = false): void {
    if (isRoot) return;
    // When namespaceSeparator is null ("none"), never auto-create groups from names
    if (namespaceSeparator === null) {
      registerNodeInGroup(nodeId);
      return;
    }
    if (nodeId.includes(namespaceSeparator)) {
      const parts = nodeId.split(namespaceSeparator);
      const pkgParts = parts.slice(0, -1);
      if (pkgParts.length === 0) return;
      const pkgSegments = useIntermediatePackages ? pkgParts : [pkgParts.join(namespaceSeparator)];
      const chain = findOrCreateGroupChain(pkgSegments, 'package');
      if (chain.length > 0) {
        const target = chain[chain.length - 1];
        if (!target.children.includes(nodeId)) {
          target.children.push(nodeId);
        }
      }
    } else {
      registerNodeInGroup(nodeId);
    }
  }

  // Diagram context is now determined externally by dispatcher.detectDiagramContext()
  // and passed in via options.diagramContext. No more internal global scanning.

  const defaultNodeType = isStateDiagram ? NodeType.State : NodeType.Class;

  // Pre-scan: detect if any routing_relation has arrow heads.
  // In deployment/description context this determines whether implicit nodes
  // are rendered as circles (no arrow heads) or class rectangles (with arrow heads).
  let hasArrowHeadInRouting = false;
  if (isDeploymentContext) {
    for (const st0 of statements) {
      if (!st0 || typeof st0 !== 'object') continue;
      if (st0.kind === 'generic_statement' && st0.type === 'routing_relation' && st0.arrowMeta) {
        const startHead = String(st0.arrowMeta.startHeadToken || '');
        const endHead = String(st0.arrowMeta.endHeadToken || '');
        if (startHead || endHead) {
          hasArrowHeadInRouting = true;
          break;
        }
      }
    }
  }

  // Pre-scan: build sprite map from "sprite $name jar:archimate/stereotype" directives.
  // Used to resolve <<$name>> stereotypes on rectangle declarations (003-style archimate diagrams).
  const spriteMap: Record<string, string> = {};
  for (const st0 of statements) {
    if (!st0 || typeof st0 !== 'object') continue;
    if (st0.kind === 'preprocessor_statement' && st0.cmd === 'sprite') {
      const spriteName = String(st0.id   || '').trim();   // e.g. "$bProcess"
      const spriteSrc  = String(st0.src  || '').trim();   // e.g. "jar:archimate/business-process"
      const m = spriteSrc.match(/^jar:archimate\/(.+)$/i);
      if (m && spriteName.startsWith('$')) {
        spriteMap[spriteName] = m[1]; // "$bProcess" → "business-process"
      }
    }
  }

  // Pre-scan: collect !define macros that expand to "circle #color"
  // e.g. "!define Junction_Or circle #black" → { 'Junction_Or': '#black' }
  // PEG now emits { cmd:'define', name, body } via DefineLine rule.
  const junctionColorMap: Record<string, string> = {};
  for (const st0 of statements) {
    if (!st0 || typeof st0 !== 'object') continue;
    if (st0.kind === 'preprocessor_statement' && st0.cmd === 'define' && st0.name) {
      const m = String(st0.body || '').match(/^circle\s+(#\S+)/i);
      if (m) junctionColorMap[String(st0.name)] = m[1];
    }
  }

  for (let i = 0; i < statements.length; i++) {
    const st = statements[i];
    if (!st || typeof st !== 'object') continue;

    // Multi-line note block — note_text_line / note_end no longer emitted by pre-parser
    if (st.kind === 'note_text_line' || st.kind === 'note_end') continue;

    // <style> block accumulation
    if (styleBlockAccum) {
      if (st.kind === 'block_statement' && st.type === 'style_block_end') {
        cssStyleRules[styleBlockAccum.name] = styleBlockAccum.props;
        styleBlockAccum = null;
        continue;
      }
      // Parse "Key Value" lines inside <style> block
      const rawText = String(st.text || st.raw || '').trim();
      if (rawText) {
        const spIdx = rawText.indexOf(' ');
        if (spIdx > 0) {
          const key = rawText.slice(0, spIdx).trim();
          const val = rawText.slice(spIdx + 1).trim();
          styleBlockAccum.props[key.toLowerCase()] = val;
        }
      }
      continue;
    }

    // Legend block accumulation
    if (legendBlock) {
      if (st.kind === 'block_statement' && st.type === 'legend_end') {
        legend = {
          text: legendBlock.lines.join('\n'),
          align: legendBlock.align || undefined,
        };
        legendBlock = null;
        continue;
      }
      // legend_text_line or any other line inside legend block
      const text = String(st.text || st.raw || '').trim();
      if (text) legendBlock.lines.push(text);
      continue;
    }

    // Process statement by kind
    {

      // <style> block start: "actor {", ".stereo {", "componentDiagram {}" etc.
      // 'together { }' is a transparent grouping hint — not a CSS style block.
      // Strip leading '.' from CSS class selectors (e.g. '.stereo' -> 'stereo')
      if (st.kind === 'block_statement' && st.type === 'style_block_start') {
        if (/^together$/i.test(String(st.name || ''))) {
          blockPushCounts.push(0);
          continue;
        }
        styleBlockAccum = { name: String(st.name || '').toLowerCase().replace(/^\./, ''), props: {} };
        continue;
      }

      // Capture layout direction directive
      if (st.kind === 'directive_statement') {
        const kw = String(st.keyword || '').toLowerCase().trim();
        // Stop at newpage — only render the first page
        if (kw === 'newpage') break;
        if (kw === 'left to right direction') rankdir = 'LR';
        else if (kw === 'top to bottom direction') rankdir = 'TB';
        // Handle "set namespaceSeparator <sep>" or "set separator <sep>" directive
        if (kw === 'set' && (st.key === 'namespaceSeparator' || st.key === 'separator')) {
          const val = String(st.text || '').trim();
          namespaceSeparator = val.toLowerCase() === 'none' ? null : val;
        }
        // Parse "skinparam <key> <value>" directives
        if (kw === 'skinparam') {
          if (st.block === true) {
            // Block form: skinparam node { BackgroundColor #dae8fc }
            const prefix = String(st.text || '').trim();
            for (let j = i + 1; j < statements.length; j++) {
              const child = statements[j];
              if (!child) continue;
              if (child.kind === 'block_statement' && child.type === 'style_block_end') break;
              if (child.kind === 'style_text_line') {
                const line = String(child.text || '').trim();
                const m = line.match(/^(\w+)\s+(.+)$/);
                if (m) {
                  skinparams[(prefix ? prefix + m[1] : m[1])] = m[2].trim();
                }
              }
            }
          } else if (st.key) {
            skinparams[st.key] = String(st.value || st.text || '').trim();
          } else if (st.text) {
            // PEG may emit text="key value" without separate key/value fields
            const txt = String(st.text).trim();
            const spIdx = txt.indexOf(' ');
            if (spIdx > 0) {
              skinparams[txt.slice(0, spIdx)] = txt.slice(spIdx + 1).trim();
            }
          }
        }
        // Handle "remove <name>", "remove $tag", "remove *", "restore ..." directives
        if ((kw === 'remove' || kw === 'restore') && st.text) {
          const target = String(st.text).trim();
          const action = kw as 'remove' | 'restore';
          if (target === '*') {
            removeRules.push({ action, target: '*' });
          } else if (target.startsWith('$') || target.startsWith('@')) {
            removeRules.push({ action, target });
          } else {
            removeRules.push({ action, target: normalizeId(target) });
          }
        }
        // Handle "hide ..." / "show ..." visibility directives
        if ((kw === 'hide' || kw === 'show') && st.text) {
          const action = kw as 'hide' | 'show';
          const body = String(st.text).trim();
          // Parse: [scope] aspect
          // aspect is last word: members|fields|attributes|methods|circle|stereotypes|empty
          // scope is everything before aspect, or '*' if omitted
          const ASPECTS = new Set(['members', 'fields', 'attributes', 'methods', 'circle', 'stereotypes', 'empty']);
          const words = body.split(/\s+/);
          const lastWord = words[words.length - 1].toLowerCase();
          if (ASPECTS.has(lastWord)) {
            const scopeStr = words.length > 1 ? words.slice(0, -1).join(' ') : '*';
            const aspect = lastWord === 'attributes' ? 'fields' : lastWord;
            visRules.push({ action, scope: scopeStr, aspect });
          } else if (action === 'hide') {
            // "hide empty members/fields/methods" — not yet implemented.
            // "hide ClassName" — hide the entire class (same as remove).
            // "hide $tag" — hide classes with the given tag.
            const emptyMatch = body.match(/^empty\s+(members|fields|attributes|methods)$/i);
            if (emptyMatch) {
              // "hide empty fields" — not yet implemented; ignore for now
            } else if (body.startsWith('$') || body.startsWith('@')) {
              // Tag-based hiding: "hide $tag13" or special target: "hide @unlinked"
              removeRules.push({ action: 'remove', target: body });
            } else {
              // Bare name: "hide Foo2" → remove the class entirely
              removeRules.push({ action: 'remove', target: normalizeId(body) });
            }
          }
        }
        continue;
      }

      // ── Use-case diagram declarations ────────────────────────────────────

      const declType = String(st?.type || '').toLowerCase();

      // Junction node (from "!define Junction_Or circle #black" + "Junction_Or Foo")
      // PEG emits: { kind: 'Junction_And'|'Junction_Or', type: 'junction', name }
      if (declType === 'junction') {
        const macroName = String(st.kind || '');
        const name = String(st.name || '').trim();
        if (name) {
          const id = normalizeId(name);
          const fillColor = junctionColorMap[macroName] || null;
          // Map macro kind to archimate junction stereotype
          const junctionStereotype = macroName.includes('And')
            ? 'archimate-junction-and'
            : 'archimate-junction-or';
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Class,
            label: name,
            stereotype: junctionStereotype,
            stereotypeLabel: '',
            bodyLines: [],
            color: fillColor ?? undefined,
          };
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Standalone usecase shorthand: "(First usecase)" parsed as activity_statement with paren
      if (st.kind === 'activity_statement' && st.paren) {
        const label = String(st.text || '').trim();
        const id = normalizeId(label);
        if (id && !nodesById[id]) {
          nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Usecase,
            label,
            stereotype: 'usecase',
            stereotypeLabel: '',
            bodyLines: [],
          };
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Usecase declaration: "(First usecase)" or "(Another usecase) as (UC2)"
      // or "usecase UC as Label" or "usecase (text) as alias"
      if (st.kind === 'declaration_statement' && declType === 'usecase') {
        const rawName = String(st.name || '').trim();
        const rawAlias = String(st.alias || '').trim();
        const rawLabel = String(st.label || '').trim();
        // Extract display text from (parenthesized) names
        const nameInner = rawName.startsWith('(') && rawName.endsWith(')') ? rawName.slice(1, -1) : rawName;
        // Business usecase variant (trailing /): strip for display
        const isBusiness = nameInner.endsWith('/') || rawName.endsWith('/');
        const cleanName = isBusiness ? nameInner.replace(/\/$/, '') : nameInner;
        const aliasInner = rawAlias.startsWith('(') && rawAlias.endsWith(')') ? rawAlias.slice(1, -1) : rawAlias;
        const label = rawLabel || cleanName;
        const id = normalizeId(aliasInner || cleanName);
        // Build stereotype text
        const stereos: string[] = Array.isArray(st.stereotypes) ? st.stereotypes.map(s => typeof s === 'string' ? s : (s && s.text || '')) : [];
        const stereotypeLabel = stereos.map(s => `«${s}»`).join(' ');
        if (id) {
          // Register alias mapping so relations using the original name resolve correctly
          if (rawAlias && normalizeId(cleanName) !== id) {
            // Map the original parenthesized name to the alias id
            if (!nodesById[normalizeId(cleanName)]) {
              // Pre-register alias target
            }
          }
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Usecase,
            label,
            stereotype: isBusiness ? 'usecase/' : 'usecase',
            stereotypeLabel: stereotypeLabel || '',
            bodyLines: [],
            style: st.style || null,
          };
          // Also register under the parenthesized form so relations resolve
          if (rawName && normalizeId(rawName) !== id) {
            const origId = normalizeId(rawName.replace(/\/$/, ''));
            if (!nodesById[origId]) {
              nodesById[origId] = nodesById[id];
            }
          }
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Usecase alias: '"Display Name" as (Alias)' or '"Name" as Alias'
      if (st.kind === 'declaration_statement' && declType === 'usecase_alias') {
        const rawLabel = String(st.label || '').trim();
        const rawAlias = String(st.alias || '').trim();
        const isUsecase = rawAlias.startsWith('(') && rawAlias.endsWith(')');
        const isColonActor = rawAlias.startsWith(':') && rawAlias.endsWith(':');
        // In use-case context, bare alias (no parens) is an actor
        const isActor = isColonActor || (!isUsecase && isUsecaseContext);
        const aliasInner = isUsecase ? rawAlias.slice(1, -1) : rawAlias;
        const actorInner = isColonActor ? rawAlias.slice(1, -1) : rawAlias;
        const id = normalizeId(isActor ? actorInner : aliasInner);
        const label = rawLabel;
        const nodeType = isActor ? NodeType.UsecaseActor : (isUsecaseContext ? NodeType.Usecase : NodeType.Class);
        if (id) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: nodeType,
            label,
            stereotype: null,
            stereotypeLabel: '',
            bodyLines: [],
          };
          // Also register under the label as an alias
          const labelId = normalizeId(rawLabel);
          if (labelId && labelId !== id && !nodesById[labelId]) {
            nodesById[labelId] = nodesById[id];
          }
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Actor declaration: ":First Actor:" or ":name: as alias << stereotype >>"
      if (st.kind === 'declaration_statement' && declType === 'usecase_actor') {
        const rawName = String(st.name || '').trim();
        const rawAlias = String(st.alias || '').trim();
        // Strip surrounding colons from name: ":Actor:" → "Actor"
        let nameInner = rawName;
        if (nameInner.startsWith(':') && (nameInner.endsWith(':') || nameInner.endsWith(':/'))) {
          nameInner = nameInner.replace(/^:/, '').replace(/:?\/?$/, '');
        }
        const isBusiness = rawName.endsWith('/');
        const id = normalizeId(rawAlias || nameInner);
        const label = nameInner;
        const stereos: string[] = Array.isArray(st.stereotypes) ? st.stereotypes.map(s => typeof s === 'string' ? s : (s && s.text || '')) : [];
        const stereotypeLabel = stereos.map(s => `«${s}»`).join(' ');
        if (id) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.UsecaseActor,
            label,
            stereotype: isBusiness ? 'actor/' : 'actor',
            stereotypeLabel: stereotypeLabel || '',
            bodyLines: [],
            style: st.style || null,
          };
          // Also register under the raw colon-wrapped form
          const colonId = normalizeId(rawName.replace(/\/$/, ''));
          if (colonId !== id && !nodesById[colonId]) {
            nodesById[colonId] = nodesById[id];
          }
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // ── ArchiMate declarations ───────────────────────────────────────────

      // ArchiMate declaration: "archimate #BUSINESS "Label" <<business-service>> as svc"
      if (st.kind === 'declaration_statement' && declType === 'archimate') {
        const rawLabel = String(st.label || '').trim();
        const rawAlias = String(st.alias || '').trim();
        const id = normalizeId(rawAlias || rawLabel);
        const label = rawLabel;
        // Stereotype may be a plain string or an object with .text
        let stereo: string | null = null;
        if (st.stereotype) {
          stereo = typeof st.stereotype === 'string' ? st.stereotype : (st.stereotype.text || null);
        }
        if (id) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Class,
            label,
            stereotype: stereo || 'archimate',
            stereotypeLabel: '',
            bodyLines: [],
            style: st.style || null,
            centeredIcon: true,
          };
          // Apply layer color from tag as inline style
          if (st.tag) {
            const bg = resolveArchimateLayerColor(st.tag);
            if (bg) nodesById[id].style = bg;
          }
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Rectangle declarations with archimate stereos: "rectangle "Label" as HC <<$bProcess>> #Business"
      // Handles sprite-based stereotypes (003) and $archimate/XXX stereotypes (004).
      if (st.kind === 'declaration_statement' && (declType === 'rectangle' || declType === 'rect')) {
        const stereos: string[] = Array.isArray(st.stereotypes)
          ? st.stereotypes.map(s => typeof s === 'string' ? s : (s?.text || ''))
          : [];
        let archimateStereotype: string | null = null;
        for (const s of stereos) {
          // Direct $archimate/XXX pattern: <<$archimate/business-process>>
          const direct = s.match(/^\$archimate\/(.+)$/);
          if (direct) { archimateStereotype = direct[1]; break; }
          // Sprite map lookup: <<$bProcess>> where spriteMap['$bProcess']='business-process'
          if (spriteMap[s]) { archimateStereotype = spriteMap[s]; break; }
        }
        if (archimateStereotype) {
          const rawLabel = String(st.label || st.name || '').trim();
          const rawAlias = String(st.alias || '').trim();
          const id = normalizeId(rawAlias || rawLabel);
          const label = rawLabel;
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            const bg = st.tag ? resolveArchimateLayerColor(st.tag) : null;
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: archimateStereotype,
              stereotypeLabel: '',
              bodyLines: [],
              style: bg || st.style || null,
              centeredIcon: true,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
        // No archimate stereotype — handle as rectangle group or node
        if (st.block) {
          // Rectangle with block: create a group (container)
          const rawLabel = String(st.label || st.name || '').trim();
          const rawAlias = String(st.alias || '').trim();
          const stereotype = stereos.length > 0 ? stereos[0] : undefined;
          const segments = [rawAlias || rawLabel || declType];
          const startParent = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
          const chain = findOrCreateGroupChain(segments, declType, startParent, stereotype);
          if (chain.length > 0) {
            const leaf = chain[chain.length - 1];
            if (st.style) leaf.style = st.style;
            // Set display label when alias differs from label
            if (rawAlias && rawLabel && rawAlias !== rawLabel) {
              leaf.label = rawLabel;
            }
          }
          for (const g of chain) groupStack.push(g);
          blockPushCounts.push(chain.length);
          continue;
        } else {
          // Rectangle without block: create a node
          const rawLabel = String(st.label || st.name || '').trim();
          const rawAlias = String(st.alias || '').trim();
          const id = normalizeId(rawAlias || rawLabel);
          const label = rawLabel;
          const stereotypeLabel = stereos.map(s => `«${s}»`).join(' ');
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: 'rectangle',
              stereotypeLabel: stereotypeLabel || '',
              bodyLines: [],
              style: st.style || null,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
      }

      // mxgraph icon declaration: "mxgraph.aws4.compute.awsLambda "Label" as alias #color"
      if (st.kind === 'generic_statement' && st.type === 'mxgraph_icon') {
        const shapeKey = String(st.shapeKey || '').trim();
        const rawLabel = String(st.label || '').trim();
        const rawAlias = String(st.alias || '').trim();
        const rawColor = String(st.color || '').trim() || null;
        const id = normalizeId(rawAlias || rawLabel);
        const label = rawLabel;
        if (id && shapeKey) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Class,
            label,
            stereotype: shapeKey,
            stereotypeLabel: '',
            bodyLines: [],
            style: rawColor || null,
          };
          ensureNodeInCorrectGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // ArchiMate stdlib element macros: "Business_Service(svc, "Label")"
      if (st.kind === 'generic_statement' && st.type === 'generic_call') {
        const macroInfo = lookupArchimateElementMacro(st.name);
        if (macroInfo) {
          const [alias, label] = parseArchimateElementArgs(st.args || '');
          const id = normalizeId(alias);
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            const bg = resolveArchimateLayerColor(macroInfo.layer);
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: macroInfo.stereotype,
              stereotypeLabel: '',
              bodyLines: [],
              style: bg || null,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }

        // awslib stdlib macros: "EC2(alias, "Label", "tech")"
        if (isKnownAwslibSprite(st.name)) {
          const args = (st.args || '').split(',');
          const alias = args[0] ? args[0].trim().replace(/^"|"$/g, '') : '';
          const rawLabel = args[1] ? args[1].trim().replace(/^"|"$/g, '') : st.name;
          const label = rawLabel || st.name;
          const id = normalizeId(alias || st.name);
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            const awsInfo = lookupAwslibMacro(st.name);
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: awsInfo ? awsInfo.shapeKey : 'mxgraph.aws4.resourceIcon.general',
              stereotypeLabel: '',
              bodyLines: [],
              style: null,
              resIcon:     awsInfo?.resIcon,
              fillColor:   awsInfo?.fillColor,
              strokeColor: awsInfo?.strokeColor,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }

        const relInfo = lookupArchimateRelMacro(st.name);
        if (relInfo) {
          const [fromArg, toArg, label] = parseArchimateRelArgs(st.args || '');
          const from = normalizeId(fromArg);
          const to = normalizeId(toArg);
          if (from && to) {
            // Ensure endpoints exist as nodes
            if (!nodesById[from]) {
              nodeOrder.push(from);
              nodesById[from] = { id: from, type: NodeType.Class, label: from, stereotype: 'archimate-junction-or', stereotypeLabel: '', bodyLines: [] };
              registerNodeInGroup(from);
            }
            if (!nodesById[to]) {
              nodeOrder.push(to);
              nodesById[to] = { id: to, type: NodeType.Class, label: to, stereotype: 'archimate-junction-or', stereotypeLabel: '', bodyLines: [] };
              registerNodeInGroup(to);
            }
            edges.push({
              id: `e${edges.length + 1}`,
              type: relInfo.edgeType as any,
              from,
              to,
              label,
              arrow: (relInfo.arrowMeta as any).token,
              arrowMeta: relInfo.arrowMeta,
              direction: relInfo.direction || null,
            });
          }
          continue;
        }

        // C4 stdlib element macros: "Person(alias, "Label", "description")"
        const c4Elem = lookupC4ElementMacro(st.name);
        if (c4Elem) {
          const parsed = parseC4ElementArgs(st.args || '', c4Elem);
          const id = normalizeId(parsed.alias);
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            // Build Creole-formatted bodyLines for C4 styled label
            const bodyLines: string[] = [];
            bodyLines.push(`<size:12>//\u00AB${c4Elem.stereotypeTag}\u00BB//</size>`);
            bodyLines.push(`<size:16>**${parsed.label}**</size>`);
            if (parsed.technology) {
              bodyLines.push(`<size:12>//[${parsed.technology}]//</size>`);
            }
            if (parsed.description) {
              bodyLines.push('');
              bodyLines.push(`<size:14>${parsed.description}</size>`);
            }
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label: parsed.label,
              stereotype: c4Elem.renderer,
              stereotypeLabel: '',
              bodyLines,
              style: `#${c4Elem.bgColor};text:${c4Elem.fontColor}`,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }

        // C4 stdlib relation macros: "Rel(from, to, "label")"
        const c4Rel = lookupC4RelMacro(st.name);
        if (c4Rel) {
          const parsed = parseC4RelArgs(st.args || '');
          const from = normalizeId(parsed.from);
          const to = normalizeId(parsed.to);
          if (from && to) {
            const actualFrom = c4Rel.back ? to : from;
            const actualTo = c4Rel.back ? from : to;
            const arrowToken = c4Rel.biDirectional ? '<-->' : '-->';
            edges.push({
              id: `e${edges.length + 1}`,
              type: EdgeType.Dependency,
              from: actualFrom,
              to: actualTo,
              label: parsed.label || '',
              arrow: arrowToken,
              direction: c4Rel.direction || null,
            });
          }
          continue;
        }

        // Not an archimate/C4 macro — fall through to other handlers
      }

      // ArchiMate macros that PEG mis-parses as sequence_block (e.g. "Group(...)").
      // sequence_block: st.keyword is lowercase; macro keys are PascalCase.
      // st.text contains the raw arg string including outer parens: "(alias, label)"
      if (st.kind === 'block_statement' && st.type === 'sequence_block') {
        const kw = String(st.keyword || '');
        const capitalized = kw.charAt(0).toUpperCase() + kw.slice(1);
        const macroInfo = lookupArchimateElementMacro(capitalized);
        if (macroInfo) {
          // Strip outer parens from st.text to obtain the args string
          const rawText = String(st.text || '');
          const argsStr = rawText.startsWith('(') ? rawText.slice(1, rawText.lastIndexOf(')')) : rawText;
          const [alias, label] = parseArchimateElementArgs(argsStr);
          const id = normalizeId(alias);
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            const bg = resolveArchimateLayerColor(macroInfo.layer);
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: macroInfo.stereotype,
              stereotypeLabel: '',
              bodyLines: [],
              style: bg || null,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
        // awslib sprite mis-parsed as sequence_block
        if (isKnownAwslibSprite(capitalized)) {
          const rawText = String(st.text || '');
          const argsStr = rawText.startsWith('(') ? rawText.slice(1, rawText.lastIndexOf(')')) : rawText;
          const args = argsStr.split(',');
          const alias = args[0] ? args[0].trim().replace(/^"|"$/g, '') : '';
          const rawLabel = args[1] ? args[1].trim().replace(/^"|"$/g, '') : capitalized;
          const label = rawLabel || capitalized;
          const id = normalizeId(alias || capitalized);
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            const awsInfo = lookupAwslibMacro(capitalized);
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: awsInfo ? awsInfo.shapeKey : 'mxgraph.aws4.resourceIcon.general',
              stereotypeLabel: '',
              bodyLines: [],
              style: null,
              resIcon:     awsInfo?.resIcon,
              fillColor:   awsInfo?.fillColor,
              strokeColor: awsInfo?.strokeColor,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
      }

      // ArchiMate macros that PEG mis-parses as block_statement|group
      // e.g. "Grouping(alias, "Label")" — PEG strips the leading "Group" keyword
      // so st.type='group' and st.text='ing(alias, "Label")'.
      // Reconstruct the full call from st.raw and re-look up the macro.
      if (st.kind === 'block_statement' && st.type === 'group') {
        const raw = String(st.raw || '');
        const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/);
        if (m) {
          const macroInfo = lookupArchimateElementMacro(m[1]);
          if (macroInfo) {
            const [alias, label] = parseArchimateElementArgs(m[2]);
            const id = normalizeId(alias);
            if (id) {
              if (!nodesById[id]) nodeOrder.push(id);
              const bg = resolveArchimateLayerColor(macroInfo.layer);
              nodesById[id] = {
                id,
                type: NodeType.Class,
                label,
                stereotype: macroInfo.stereotype,
                stereotypeLabel: '',
                bodyLines: [],
                style: bg || null,
              };
              registerNodeInGroup(id);
              lastDefinedClass = id;
            }
            continue;
          }
          // awslib sprite mis-parsed as block_statement|group
          if (isKnownAwslibSprite(m[1])) {
            const args = m[2].split(',');
            const alias = args[0] ? args[0].trim().replace(/^"|"$/g, '') : '';
            const rawLabel = args[1] ? args[1].trim().replace(/^"|"$/g, '') : m[1];
            const label = rawLabel || m[1];
            const id = normalizeId(alias || m[1]);
            if (id) {
              if (!nodesById[id]) nodeOrder.push(id);
              const awsInfo = lookupAwslibMacro(m[1]);
              nodesById[id] = {
                id,
                type: NodeType.Class,
                label,
                stereotype: awsInfo ? awsInfo.shapeKey : 'mxgraph.aws4.resourceIcon.general',
                stereotypeLabel: '',
                bodyLines: [],
                style: null,
                resIcon:     awsInfo?.resIcon,
                fillColor:   awsInfo?.fillColor,
                strokeColor: awsInfo?.strokeColor,
              };
              registerNodeInGroup(id);
              lastDefinedClass = id;
            }
            continue;
          }
        }
      }

      // Actor/usecase via component_statement (non-block): "actor Guest as g" or "usecase c #style"
      if (st.kind === 'component_statement' && !st.block) {
        const ctype = String(st.componentType || '').toLowerCase();
        if (ctype === 'actor' || ctype === 'actor/' || ctype === 'usecase' || ctype === 'usecase/') {
          const rawName = String(st.name || '').trim();
          const rawAlias = String(st.alias || '').trim();
          // Strip surrounding colons from colon-style names
          let nameInner = rawName;
          if (nameInner.startsWith(':') && nameInner.endsWith(':')) {
            nameInner = nameInner.slice(1, -1);
          }
          const id = normalizeId(rawAlias || nameInner);
          const label = String(st.displayName || nameInner || '').trim();
          const isActor = ctype.startsWith('actor');
          const isBusiness = ctype.endsWith('/');
          const nodeType = isActor ? NodeType.UsecaseActor : NodeType.Usecase;
          const stereos: string[] = Array.isArray(st.stereotypes) ? st.stereotypes.map(s => typeof s === 'string' ? s : (s && s.text || '')) : [];
          const stereotypeLabel = stereos.map(s => `«${s}»`).join(' ');
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            nodesById[id] = {
              id,
              type: nodeType,
              label,
              stereotype: isBusiness ? ctype : (isActor ? 'actor' : 'usecase'),
              stereotypeLabel: stereotypeLabel || '',
              bodyLines: [],
              style: st.style || null,
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }

        // All other component_statement (non-block, non-actor/usecase):
        // e.g. label "text", agent "name" as a, cloud "C1" #pink
        // Parser is permissive — let the renderer detect unimplemented shapes.
        {
          const rawName = String(st.name || '').trim();
          const rawAlias = String(st.alias || '').trim();
          const id = normalizeId(rawAlias || rawName);
          const stereos: string[] = Array.isArray(st.stereotypes) ? st.stereotypes.map(s => typeof s === 'string' ? s : (s && s.text || '')) : [];
          // package type: tab shows reference identifier; quoted display name goes to body (stereotypeLabel)
          let label: string;
          let stereotypeLabel: string;
          if (ctype === 'package' && st.displayName) {
            label = (rawAlias || rawName);
            stereotypeLabel = st.displayName;
          } else {
            label = String(st.displayName || rawName || '').trim();
            // Strip brackets from component_ref labels: "[Name]" → "Name"
            if (label.startsWith('[') && label.endsWith(']')) label = label.slice(1, -1).trim();
            stereotypeLabel = stereos.map(s => `«${s}»`).join(' ');
          }
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            // Port nodes (port/portin/portout) — small square on group boundary
            if (ctype === 'port' || ctype === 'portin' || ctype === 'portout') {
              const portType: 'portin' | 'portout' = ctype === 'portout' ? 'portout' : 'portin';
              nodesById[id] = {
                id,
                type: NodeType.Class,
                label,
                stereotype: portType,
                stereotypeLabel: '',
                bodyLines: [],
                style: st.style || null,
                isPort: true,
                portType,
                tags: Array.isArray(st.tags) && st.tags.length ? st.tags : (st.tag ? [st.tag] : undefined),
              };
            } else {
              // Map component_ref → component; interface → circle in deployment context
              let mappedStereotype = ctype;
              if (ctype === 'component_ref') mappedStereotype = 'component';
              else if (ctype === 'interface' && isDeploymentContext) mappedStereotype = 'circle';
              nodesById[id] = {
                id,
                type: NodeType.Class,
                label,
                stereotype: mappedStereotype,
                stereotypeLabel: stereotypeLabel || '',
                bodyLines: [],
                style: st.style || null,
                tags: Array.isArray(st.tags) && st.tags.length ? st.tags : (st.tag ? [st.tag] : undefined),
              };
            }
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
      }

      // PEG parses "label <name>" as jump_statement (activity diagram keyword).
      // In deployment context, treat it as a deployment shape node declaration.
      if (st.kind === 'jump_statement' && String(st.keyword || '').toLowerCase() === 'label') {
        const rawName = String(st.target || '').trim();
        const id = normalizeId(rawName);
        if (id) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Class,
            label: rawName,
            stereotype: 'label',
            stereotypeLabel: '',
            bodyLines: [],
            style: st.style || null,
          };
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Bracket component shorthand: [Name] or [Name] as alias → component node (non-sequence context)
      if (st.kind === 'generic_statement' && st.type === 'bracketed_event') {
        const rawName = String(st.head || '').trim();
        const tailText = String(st.text || '').trim();
        // Parse "as <alias>" from tail text
        const aliasMatch = tailText.match(/^as\s+(\S+)/i);
        const alias = aliasMatch ? aliasMatch[1].replace(/^"|"$/g, '') : '';
        const id = normalizeId(alias || rawName);
        if (id) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Class,
            label: rawName,
            stereotype: 'component',
            stereotypeLabel: '',
            bodyLines: [],
          };
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Actor/usecase via TypedMemberLine: "actor foo" or "usecase UC3"
      if (st.kind === 'declaration_statement' && declType === 'member') {
        const dataType = String(st.dataType || '').toLowerCase();
        if (dataType === 'actor' || dataType === 'usecase') {
          const rawName = String(st.name || '').trim();
          const id = normalizeId(rawName);
          const label = rawName;
          const nodeType = dataType === 'actor' ? NodeType.UsecaseActor : NodeType.Usecase;
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            nodesById[id] = {
              id,
              type: nodeType,
              label,
              stereotype: dataType,
              stereotypeLabel: '',
              bodyLines: [],
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }

        // All other typed member declarations: "agent foo", "cloud bar", etc.
        // Parser is permissive — let the renderer detect unimplemented shapes.
        // Only applies when dataType is non-empty (TypedMemberLine); colon-style
        // "Owner : member()" has no dataType and must fall through to the owner handler.
        if (dataType) {
          const rawName = String(st.name || '').trim();
          const id = normalizeId(rawName);
          const label = rawName;
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: dataType,
              stereotypeLabel: '',
              bodyLines: [],
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
      }

      // Actor/usecase via TwoColumnLine: "actor  用户" or "usecase  用例"
      if (st.kind === 'generic_statement' && st.type === 'two_column') {
        const left = String(st.left || '').toLowerCase();
        if (left === 'actor' || left === 'usecase') {
          const rawName = String(st.right || '').trim();
          const id = normalizeId(rawName);
          const label = rawName;
          const nodeType = left === 'actor' ? NodeType.UsecaseActor : NodeType.Usecase;
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            nodesById[id] = {
              id,
              type: nodeType,
              label,
              stereotype: left,
              stereotypeLabel: '',
              bodyLines: [],
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
        // Deployment keyword via TwoColumnLine: "node  foo" / "cloud  C" etc.
        // Occurs when PEG parses "keyword  name" (2+ spaces) as two_column.
        if (DEPLOYMENT_COMPONENT_KEYWORDS.has(left)) {
          const rawName = String(st.right || '').trim();
          const id = normalizeId(rawName);
          const label = rawName;
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            nodesById[id] = {
              id,
              type: NodeType.Class,
              label,
              stereotype: left,
              stereotypeLabel: '',
              bodyLines: [],
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
      }

      // Actor/usecase via slashy_relation misparse: "actor/ Woman3" or "usecase/ UC3"
      if (st.kind === 'generic_statement' && st.type === 'slashy_relation') {
        const rawFrom = String(st.from || '').toLowerCase();
        if (rawFrom === 'actor' || rawFrom === 'usecase') {
          const rawTo = String(st.to || '').trim();
          const id = normalizeId(rawTo);
          const label = rawTo;
          const nodeType = rawFrom === 'actor' ? NodeType.UsecaseActor : NodeType.Usecase;
          if (id) {
            if (!nodesById[id]) nodeOrder.push(id);
            nodesById[id] = {
              id,
              type: nodeType,
              label,
              stereotype: rawFrom + '/',
              stereotypeLabel: '',
              bodyLines: [],
            };
            registerNodeInGroup(id);
            lastDefinedClass = id;
          }
          continue;
        }
      }

      // Entity block: "entity Entity01 { ... }" — rendered as class-like node, not a group.
      // Handles alias: entity "Entity01" as e01 { ... } → id=e01, label=Entity01.
      // Consume entity_body_line statements until entity_block_end.
      if (st.kind === 'component_statement' && st.block && String(st.componentType || '').toLowerCase() === 'entity') {
        const rawName = String(st.name || '').trim();
        const rawAlias = String(st.alias || '').trim();
        const id = normalizeId(rawAlias || rawName);
        const label = rawName || rawAlias || id;
        if (id) {
          const bodyLines: BodyLine[] = [];
          while (i + 1 < statements.length) {
            i++;
            const innerSt = statements[i];
            if (!innerSt || typeof innerSt !== 'object') continue;
            if (innerSt.kind === 'block_statement' && innerSt.type === 'entity_block_end') break;
            if (innerSt.kind !== 'entity_body_line') continue;
            const inner = String(innerSt.text || innerSt.raw || '').trim();
            if (!inner) continue;
            const vis = innerSt.visibility || '';
            bodyLines.push(vis ? vis + inner : inner);
          }
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Class,
            label,
            // In class context, entity block renders as class-like node (not deployment icon)
            stereotype: isDeploymentContext ? 'entity' : null,
            stereotypeLabel: '',
            bodyLines,
            style: st.style || null,
          };
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Package / namespace / container block start: "package A {" or "namespace net.dummy {"
      // PEG parses this as component_statement with block=true.
      // PEG provides nameSegments: dotted bare names are pre-split into segments,
      // quoted names are kept as a single-element array. No split in application layer.
      if (st.kind === 'component_statement' && st.block) {
        const ctype = String(st.componentType || '').toLowerCase();
        const rawLabel = String(st.displayName || st.name || st.alias || '').trim();
        // Extract package shape stereotype (e.g., <<Node>>, <<Cloud>>)
        const stereos: string[] = (st as any).stereotypes || [];
        const stereotype = stereos.length > 0 ? stereos[0] : undefined;
        // Use PEG-provided nameSegments directly; fall back to single-segment for legacy AST.
        // When namespaceSeparator is disabled (null/"none"), collapse segments into one.
        let segments: string[] = Array.isArray(st.nameSegments) && st.nameSegments.length > 0
          ? st.nameSegments
          : [rawLabel || ctype];
        if (namespaceSeparator === null && segments.length > 1) {
          segments = [segments.join('.')];
        }
        const startParent = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
        const alias = String(st.alias || '').trim() || undefined;
        const chain = findOrCreateGroupChain(segments, ctype, startParent, stereotype);
        // Apply color/style/alias to the innermost (leaf) group
        if (chain.length > 0) {
          const leaf = chain[chain.length - 1];
          if (st.color) leaf.color = st.color;
          if (st.style) leaf.style = st.style;
          if (alias) leaf.alias = alias;
        }
        for (const g of chain) groupStack.push(g);
        blockPushCounts.push(chain.length);
        continue;
      }

      // Transparent block: "together { }" — no group, just push 0 so
      // the matching "}" does not pop the parent group.
      // C4 boundary macros: "System_Boundary(alias, label) {" — create a group.
      if (st.kind === 'block_statement' && st.type === 'loose_block_start') {
        const looseText = String(st.text || '');
        const macroMatch = looseText.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/);
        const c4Boundary = macroMatch ? lookupC4BoundaryMacro(macroMatch[1]) : null;
        if (c4Boundary && macroMatch) {
          const parsed = parseC4BoundaryArgs(macroMatch[2]);
          const id = normalizeId(parsed.alias);
          if (id) {
            const startParent = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
            const chain = findOrCreateGroupChain([parsed.label || id], 'rectangle', startParent);
            if (chain.length > 0) {
              const leaf = chain[chain.length - 1];
              leaf.alias = id;
              leaf.style = `##[dashed]${c4Boundary.borderColor}`;
            }
            for (const g of chain) groupStack.push(g);
            blockPushCounts.push(chain.length);
          } else {
            blockPushCounts.push(0);
          }
        } else {
          blockPushCounts.push(0);
        }
        continue;
      }

      // Block end: "}" — may close a package/namespace/state block.
      // Pop as many groups as the matching block-start pushed.
      if (st.kind === 'block_statement' && (st.type === 'style_block_end' || st.type === 'block_end' || st.type === 'state_block_end')) {
        const raw = blockPushCounts.pop();
        const popCount = raw != null ? raw : 1;
        for (let j = 0; j < popCount && groupStack.length > 0; j++) {
          const g = groupStack.pop()!;
          // Compute concurrentRegions for state groups with "--"/"||" separators.
          if (g.type === 'state' && concurrentRegionBreaks[g.id]) {
            const breaks = concurrentRegionBreaks[g.id];
            const regions: string[][] = [];
            let start = 0;
            for (const bp of breaks) {
              regions.push(g.children.slice(start, bp));
              start = bp;
            }
            regions.push(g.children.slice(start));
            // Only set if we have multiple regions with at least one non-empty
            if (regions.length > 1) {
              g.concurrentRegions = regions;
            }
          }
        }
        continue;
      }

      // Bracket body: "node n [...]" — puml.ts has pre-collected lines on the statement
      // Bracket body replaces the label display, so label is cleared;
      // bodyLines carries the actual display content (may be empty).
      if (st.kind === 'block_statement' && st.type === 'component_bracket_start') {
        const ctype = String(st.componentType || '').toLowerCase();
        const name = String(st.name || '').trim();
        const bLines: string[] = Array.isArray(st.lines) ? st.lines.map(String) : [];
        const id = normalizeId(name);
        if (id) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: NodeType.Class,
            label: '',
            stereotype: ctype,
            stereotypeLabel: '',
            bodyLines: bLines,
            style: st.style || null,
          };
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Map block: "map Name {}" — puml.ts has pre-collected entries on the statement
      if (st.kind === 'block_statement' && st.type === 'map_block_start') {
        const name = String(st.name || '').trim();
        const alias = String(st.alias || '').trim();
        const id = normalizeId(alias || name);
        const label = name || id;
        const rawEntries: any[] = st.entries || [];
        const mapEntries: { key: string; value: string; linked?: boolean }[] = [];
        const mapEdges: { key: string; arrow: string; target: string }[] = [];
        for (const entry of rawEntries) {
          if (entry.linked) {
            mapEntries.push({ key: String(entry.key), value: '', linked: true });
            mapEdges.push({ key: String(entry.key), arrow: String(entry.arrow), target: String(entry.target) });
          } else {
            mapEntries.push({ key: String(entry.key), value: String(entry.value || '') });
          }
        }
        if (!nodesById[id]) nodeOrder.push(id);
        nodesById[id] = {
          id,
          type: NodeType.Class,
          label,
          stereotype: 'map',
          stereotypeLabel: '',
          mapEntries,
          style: st.style || null,
        };
        ensureNodeInCorrectGroup(id);
        lastDefinedClass = id;
        // Create edges for *-> entries (rendered as plain arrows, no diamond)
        for (const me of mapEdges) {
          // Resolve target: "foo.baz" may refer to existing node "baz" in group "foo"
          const resolvedTarget = resolveQualifiedTarget(normalizeId(me.target));
          if (!nodesById[resolvedTarget]) {
            nodeOrder.push(resolvedTarget);
            const shortLabel = (namespaceSeparator && resolvedTarget.includes(namespaceSeparator))
              ? resolvedTarget.split(namespaceSeparator).pop() : resolvedTarget;
            nodesById[resolvedTarget] = { id: resolvedTarget, type: NodeType.Class, label: shortLabel, stereotype: null, stereotypeLabel: '', bodyLines: [] };
            ensureNodeInCorrectGroup(resolvedTarget);
          }
          // Map linked entries use plain arrow style: no start arrow, filled classic end arrow
          edges.push({
            id: `e${edges.length + 1}`,
            type: EdgeType.Association,
            from: id,
            to: resolvedTarget,
            label: '',
            fromPort: me.key,
            arrow: '->',
            arrowMeta: { token: '->', startHeadToken: '', endHeadToken: '>', bodyToken: '-', lineStyle: 'solid', structured: true },
          });
        }
        continue;
      }

      // Single-line note: "note top of X : text" / "note \"text\" as N1" / "note left: text"
      if (st.kind === 'note_statement') {
        const rawText = String(st.text || '').trim();
        // "note on link" — bind to last edge
        if (st.on === 'link') {
          notes.push({
            id: `note_${notes.length + 1}`,
            text: rawText,
            position: st.dir || undefined,
            onLink: true,
            linkEdgeId: lastEdgeId || undefined,
            color: st.color || undefined,
            floating: false,
          });
          continue;
        }
        const resolved = st.target ? resolveNoteTarget(st.target) : null;
        const target = resolved ? resolved.classId : (st.dir && lastDefinedClass ? lastDefinedClass : undefined);
        const alias = st.alias || undefined;
        notes.push({
          id: alias || `note_${notes.length + 1}`,
          text: rawText,
          position: st.pos || st.dir || undefined,
          target,
          memberTarget: resolved?.memberTarget,
          floating: Boolean(st.floating),
        });
        continue;
      }

      // Multi-line note start: "note top of X" / "note as N1" / "note left"
      // Text is pre-merged by puml.ts, so handle directly like note_statement.
      if (st.kind === 'note_start') {
        const rawText = String(st.text || '').trim();
        if (st.on === 'link') {
          notes.push({
            id: `note_${notes.length + 1}`,
            text: rawText,
            position: st.dir || undefined,
            onLink: true,
            linkEdgeId: lastEdgeId || undefined,
            color: st.color || undefined,
            floating: false,
          });
          continue;
        }
        const resolved = st.target ? resolveNoteTarget(st.target) : null;
        const target = resolved ? resolved.classId : (st.dir && lastDefinedClass ? lastDefinedClass : undefined);
        const alias = st.alias || undefined;
        notes.push({
          id: alias || `note_${notes.length + 1}`,
          text: rawText,
          position: st.pos || st.dir || undefined,
          target,
          memberTarget: resolved?.memberTarget,
          floating: Boolean(st.alias),
        });
        continue;
      }

      // Multi-line legend start: "legend" / "legend left" / "legend right"
      if (st.kind === 'block_statement' && st.type === 'legend_start') {
        legendBlock = { lines: [], align: st.pos || null };
        continue;
      }

      // ── State concurrent region separator ("--" or "||") ────────────────
      // Inside a state block, PEG emits concurrent_separator for bare "--" / "||".
      // Increment the region counter so that subsequent [*] nodes get unique IDs,
      // and record the break point for concurrentRegions computation.
      if (st.kind === 'block_statement' && st.type === 'concurrent_separator' && groupStack.length > 0) {
        const sg = groupStack[groupStack.length - 1];
        if (sg.type === 'state') {
          concurrentRegionCounters[sg.id] = (concurrentRegionCounters[sg.id] || 0) + 1;
          if (!concurrentRegionBreaks[sg.id]) concurrentRegionBreaks[sg.id] = [];
          concurrentRegionBreaks[sg.id].push(sg.children.length);
        }
        continue;
      }

      // ── Legacy activity diagram handlers ─────────────────────────────

      // Legacy full arrow: "(*) --> action1" or '"action1" --> "action2"'
      if (st.kind === 'arrow_statement' && st.legacy && !st.chained) {
        const rawFrom = String(st.from || '');
        const rawTo = String(st.to || '');
        const alias = st.alias || null;
        const label = st.label || '';

        // Explicit from: clear pending merge (user chose a specific source)
        pendingMergeTargets = [];

        const fromId = ensureActivityNode(rawFrom, null, st.fromType);
        if (rawFrom === '(*)') starAsSourceCount++;

        // Inline if...then in target — detected by PEG as toType='if_inline'
        if (st.toType === 'if_inline') {
          const decisionId = createDecisionNode(String(st.toCond || ''));
          addActivityEdge(fromId, decisionId, label, st.arrow);
          branchStack.push({
            conditionNode: decisionId,
            lastTargets: [],
            beforeIf: lastTarget,
          });
          lastTarget = decisionId;
          lastDefinedClass = decisionId;
          continue;
        }

        const toId = ensureActivityNode(rawTo, alias, st.toType);
        if (rawTo === '(*)') starAsTargetCount++;

        // Check stereotypes on the arrow target for port node types (e.g. <<exitPoint>>)
        const arrowStereos: string[] = Array.isArray(st.stereotypes) ? st.stereotypes : [];
        if (arrowStereos.length > 0 && nodesById[toId]) {
          const portDir = PORT_STEREOTYPE_MAP[arrowStereos[0]];
          if (portDir) {
            nodesById[toId].type = NodeType.Class as any;
            nodesById[toId].stereotype = portDir;
            nodesById[toId].stereotypeLabel = '';
            nodesById[toId].isPort = true;
            nodesById[toId].portType = portDir;
          }
        }

        addActivityEdge(fromId, toId, label, st.arrow);
        lastTarget = toId;
        lastDefinedClass = toId;
        continue;
      }

      // Legacy chained arrow: "--> action2" (continues from last target)
      if (st.kind === 'arrow_statement' && st.legacy && st.chained) {
        const rawTo = String(st.to || '');
        const alias = st.alias || null;
        const label = st.label || '';

        const from = lastTarget || '(*)';
        if (!lastTarget && !nodesById['(*)']) {
          ensureActivityNode('(*)');
          starAsSourceCount++;
        }

        // Detect inline if...then in target (e.g. "--> if "Test" then")
        // Inline if...then in target — detected by PEG as toType='if_inline'
        if (st.toType === 'if_inline') {
          const decisionId = createDecisionNode(String(st.toCond || ''));
          addActivityEdge(from, decisionId, label, st.arrow);
          // Connect pending merge targets to decision node
          for (const mt of pendingMergeTargets) {
            if (mt !== from) addActivityEdge(mt, decisionId, '');
          }
          pendingMergeTargets = [];
          branchStack.push({
            conditionNode: decisionId,
            lastTargets: [],
            beforeIf: lastTarget,
          });
          lastTarget = decisionId;
          lastDefinedClass = decisionId;
          continue;
        }

        const toId = ensureActivityNode(rawTo, alias, st.toType);
        if (rawTo === '(*)') starAsTargetCount++;

        addActivityEdge(from, toId, label, st.arrow);
        // Apply pending merge: connect all pending branch endpoints to this target
        for (const mt of pendingMergeTargets) {
          if (mt !== from) addActivityEdge(mt, toId, '');
        }
        pendingMergeTargets = [];
        lastTarget = toId;
        lastDefinedClass = toId;
        continue;
      }

      // Legacy activity: relation_statement with (*) or simple from/to
      if (hasLegacyActivityContext && st.kind === 'relation_statement') {
        const rawFrom = String(st.from || '');
        const rawTo = String(st.to || '');
        const label = String(st.label || '');

        pendingMergeTargets = [];

        const fromId = ensureActivityNode(rawFrom);
        if (rawFrom === '(*)') starAsSourceCount++;

        const toId = ensureActivityNode(rawTo);
        if (rawTo === '(*)') starAsTargetCount++;

        addActivityEdge(fromId, toId, label, st.arrow);
        lastTarget = toId;
        lastDefinedClass = toId;
        continue;
      }

      // Legacy if statement: create a decision diamond
      if (st.kind === 'control_statement' && (st.type === 'if')) {
        const cond = String(st.cond || '');
        const decisionId = createDecisionNode(cond);

        const from = lastTarget || '(*)';
        addActivityEdge(from, decisionId, '');
        // Connect pending merge targets to decision node
        for (const mt of pendingMergeTargets) {
          if (mt !== from) addActivityEdge(mt, decisionId, '');
        }
        pendingMergeTargets = [];

        branchStack.push({
          conditionNode: decisionId,
          lastTargets: [],
          beforeIf: lastTarget,
        });
        lastTarget = decisionId;
        lastDefinedClass = decisionId;
        continue;
      }

      // else keyword: save current branch endpoint, restart from decision node
      if ((st.kind === 'block_statement' && st.type === 'sequence_block' && String(st.keyword || '').toLowerCase() === 'else') ||
          (st.kind === 'control_statement' && st.type === 'else')) {
        if (branchStack.length > 0) {
          const ctx = branchStack[branchStack.length - 1];
          // Only save the branch endpoint when the branch has a single
          // continuation (no unresolved inner divergence).  When an inner
          // if/endif produced multiple pending merge targets that were never
          // consumed by a chained arrow, the branch has diverged and its
          // endpoints become dead-ends — matching PlantUML behaviour.
          if (pendingMergeTargets.length === 0) {
            if (lastTarget) ctx.lastTargets.push(lastTarget);
          }
          pendingMergeTargets = [];
          lastTarget = ctx.conditionNode;
        }
        continue;
      }

      // endif keyword: collect branch endpoints for merge
      if (st.kind === 'control_statement' && (st.text === 'endif' || st.type === 'endif')) {
        if (branchStack.length > 0) {
          const ctx = branchStack.pop()!;
          if (lastTarget) ctx.lastTargets.push(lastTarget);
          for (const mt of pendingMergeTargets) {
            if (!ctx.lastTargets.includes(mt)) ctx.lastTargets.push(mt);
          }
          const unique = Array.from(new Set(ctx.lastTargets));
          // Filter out non-terminal targets that already have edges to other
          // targets in the set (they converge naturally, no extra merge needed)
          const terminal = unique.filter(t =>
            !edges.some(e => e.from === t && unique.includes(e.to))
          );
          const effective = terminal.length > 0 ? terminal : unique;
          if (effective.length > 1) {
            lastTarget = effective[0];
            pendingMergeTargets = effective.slice(1);
          } else if (effective.length === 1) {
            lastTarget = effective[0];
            pendingMergeTargets = [];
          } else {
            pendingMergeTargets = [];
          }
        }
        continue;
      }

      // Partition block (legacy activity group) — reuse existing group with same label
      if (st.kind === 'block_statement' && st.type === 'partition') {
        const text = String(st.text || '').trim();
        const cleaned = text.replace(/\s*\{?\s*$/, '').trim();
        const parts = cleaned.match(/^(.+?)\s+(#\S+)$/);
        const rawLabel = parts ? parts[1] : cleaned;
        const label = rawLabel.replace(/^"|"$/g, '').replace(/"/g, '').trim();
        const color = parts ? parts[2] : undefined;

        // Reuse existing partition with same label at same nesting level
        const parentId = groupStack.length > 0 ? groupStack[groupStack.length - 1].id : undefined;
        let group = groups.find(g => g.type === 'partition' && g.label === label && g.parentId === parentId);
        if (!group) {
          groupCounter++;
          const groupId = `group_${groupCounter}`;
          group = {
            id: groupId,
            label,
            type: 'partition',
            stereotype: '',
            parentId,
            children: [],
            childGroups: [],
          };
          if (color) group.color = color;
          groups.push(group);
          if (groupStack.length > 0) {
            groupStack[groupStack.length - 1].childGroups.push(groupId);
          }
        }
        groupStack.push(group);
        blockPushCounts.push(1);
        continue;
      }

      // Markup title line: "title Some Title"
      if (st.kind === 'markup_statement' && st.type === 'title_line') {
        title = st.text;
        continue;
      }

      const isRelationToken = st && (
        st.kind === 'relation_statement'
        || (st.kind === 'generic_statement' && ['routing_relation', 'decorated_relation', 'slashy_relation', 'usecase_relation', 'tilde_relation', 'hash_relation'].includes(String(st.type || '')))
      );

      if (isRelationToken) {
        const rawFrom = String(st.from || '');
        const rawTo = String(st.to || '');
        // Skip bogus relations from misinterpreted skinparam lines
        // e.g. "skinparam ArrowThickness 1.5" → from="skinparam ArrowThickness 1", arrow=".", to="5"
        if (/^skinparam\s/i.test(rawFrom)) continue;
        // Port fields are pre-extracted by peggy PortedEndpoint rules
        const fromPort = st.fromPort ? String(st.fromPort) : undefined;
        const toPort = st.toPort ? String(st.toPort) : undefined;
        // Resolve names in namespace context
        const fromResolved = resolveNameInScope(normalizeId(rawFrom));
        const toResolved = resolveNameInScope(normalizeId(rawTo));
        let from = fromResolved.resolved;
        let to = toResolved.resolved;

        // Handle [*] pseudo-endpoint for state diagrams (scoped per state group)
        // In concurrent regions (separated by '--'), each region gets its own
        // unique start/end node ID via the concurrentRegionCounters map.
        if (rawFrom === '[*]') {
          const sg = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
          if (sg && sg.type === 'state') {
            const regionIdx = concurrentRegionCounters[sg.id] || 0;
            from = regionIdx > 0 ? `${sg.id}.__state_start__${regionIdx + 1}` : `${sg.id}.__state_start__`;
          } else {
            from = '__state_start__';
          }
        }
        if (rawTo === '[*]') {
          const sg = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
          if (sg && sg.type === 'state') {
            const regionIdx = concurrentRegionCounters[sg.id] || 0;
            to = regionIdx > 0 ? `${sg.id}.__state_end__${regionIdx + 1}` : `${sg.id}.__state_end__`;
          } else {
            to = '__state_end__';
          }
        }

        // Handle [H] / [H*] history pseudo-endpoints and Name[H] / Name[H*] variants.
        // [H] = shallow history of current state, [H*] = deep history of current state.
        // Name[H] / Name[H*] = history of the named state.
        from = resolveHistoryEndpoint(rawFrom, from);
        to = resolveHistoryEndpoint(rawTo, to);

        // Namespace fallback: if the qualified name doesn't exist and the raw name
        // was unqualified (no dots, no root reference), look for an existing node
        // with the same short name in any namespace.
        const nsPrefix = getCurrentNamespacePrefix();
        if (nsPrefix) {
          const rawFromNorm = normalizeId(rawFrom);
          if (!rawFromNorm.startsWith('.') && !rawFromNorm.includes('.') && !nodesById[from]) {
            const existing = findExistingNodeByShortName(rawFromNorm);
            if (existing) from = existing;
          }
          const rawToNorm = normalizeId(rawTo);
          if (!rawToNorm.startsWith('.') && !rawToNorm.includes('.') && !nodesById[to]) {
            const existing = findExistingNodeByShortName(rawToNorm);
            if (existing) to = existing;
          }
        }
        const arrow = st.arrow;
        const arrowMeta = st.arrowMeta || null;
        const label = st.label ? String(st.label).trim() : '';

        // Check if endpoints refer to existing groups (packages/namespaces).
        // If so, use the group id as the edge endpoint instead of creating a class node.
        const fromGroup = !nodesById[from] ? findGroupByQualifiedName(from) : undefined;
        const toGroup = !nodesById[to] ? findGroupByQualifiedName(to) : undefined;
        const edgeFrom = fromGroup ? fromGroup.id : from;
        const edgeTo = toGroup ? toGroup.id : to;

        // Detect lollipop (provided interface) arrows from PEG lollipop field.
        // The () side indicates a circle (interface) node.
        const lollipopFrom = st.lollipop === 'from';
        const lollipopTo = st.lollipop === 'to';

        if (!fromGroup && !nodesById[from]) {
          nodeOrder.push(from);
          if (/__state_start__\d*$/.test(from)) {
            nodesById[from] = { id: from, type: NodeType.StateStart, label: '', stereotype: null, stereotypeLabel: '', bodyLines: [] };
            registerNodeInGroup(from);
          } else {
            const shortFrom = (namespaceSeparator && from.includes(namespaceSeparator)) ? from.split(namespaceSeparator).pop() : from;
            // Detect explicit use-case endpoint syntax: (Name) → usecase, :Name: → actor
            const ucType = detectUsecaseEndpointType(rawFrom);
            if (ucType) {
              nodesById[from] = { id: from, type: ucType.type, label: ucType.label, stereotype: ucType.stereotype, stereotypeLabel: '', bodyLines: [] };
            } else if (!lollipopFrom && isUsecaseContext) {
              // Bare name in use-case context → actor (PlantUML default)
              nodesById[from] = { id: from, type: NodeType.UsecaseActor, label: shortFrom, stereotype: 'actor', stereotypeLabel: '', bodyLines: [] };
            } else if (!lollipopFrom && isDescriptionContext) {
              // Bare name in description context → actor (PlantUML default for DescriptionDiagram)
              nodesById[from] = { id: from, type: NodeType.UsecaseActor, label: shortFrom, stereotype: 'actor', stereotypeLabel: '', bodyLines: [] };
            } else if (!lollipopFrom && isDeploymentContext) {
              // Bare name in deployment context: check if original name had brackets/parens
              // () prefix → explicit interface (circle stereotype)
              // [Name] → component (null stereotype)
              // bare Name → provided interface (circle stereotype)
              const isExplicitInterface = rawFrom.startsWith('()');
              const isComponent = rawFrom.startsWith('[');
              const stereotype = isComponent ? null : 'circle';
              nodesById[from] = { id: from, type: defaultNodeType, label: shortFrom, stereotype, stereotypeLabel: '', bodyLines: [] };
            } else {
              nodesById[from] = { id: from, type: defaultNodeType, label: shortFrom, stereotype: lollipopFrom ? 'circle' : null, stereotypeLabel: '', bodyLines: [] };
            }
            ensureNodeInCorrectGroup(from, fromResolved.isRoot);
          }
        } else if (lollipopFrom && nodesById[from]) {
          nodesById[from].stereotype = 'circle';
        }
        if (!toGroup && !nodesById[to]) {
          nodeOrder.push(to);
          if (/__state_end__\d*$/.test(to)) {
            nodesById[to] = { id: to, type: NodeType.StateEnd, label: '', stereotype: null, stereotypeLabel: '', bodyLines: [] };
            registerNodeInGroup(to);
          } else {
            const shortTo = (namespaceSeparator && to.includes(namespaceSeparator)) ? to.split(namespaceSeparator).pop() : to;
            // Detect explicit use-case endpoint syntax: (Name) → usecase, :Name: → actor
            const ucType = detectUsecaseEndpointType(rawTo);
            if (ucType) {
              nodesById[to] = { id: to, type: ucType.type, label: ucType.label, stereotype: ucType.stereotype, stereotypeLabel: '', bodyLines: [] };
            } else if (!lollipopTo && isUsecaseContext) {
              // Bare name in use-case context → actor (PlantUML default)
              nodesById[to] = { id: to, type: NodeType.UsecaseActor, label: shortTo, stereotype: 'actor', stereotypeLabel: '', bodyLines: [] };
            } else if (!lollipopTo && isDescriptionContext) {
              // Bare name in description context → actor (PlantUML default for DescriptionDiagram)
              nodesById[to] = { id: to, type: NodeType.UsecaseActor, label: shortTo, stereotype: 'actor', stereotypeLabel: '', bodyLines: [] };
            } else if (!lollipopTo && isDeploymentContext) {
              // Bare name in deployment context: check if original name had brackets/parens
              // () prefix → explicit interface (circle stereotype)
              // [Name] → component (null stereotype)
              // bare Name → provided interface (circle stereotype)
              const isExplicitInterface = rawTo.startsWith('()');
              const isComponent = rawTo.startsWith('[');
              const stereotype = isComponent ? null : 'circle';
              nodesById[to] = { id: to, type: defaultNodeType, label: shortTo, stereotype, stereotypeLabel: '', bodyLines: [] };
            } else {
              nodesById[to] = { id: to, type: defaultNodeType, label: shortTo, stereotype: lollipopTo ? 'circle' : null, stereotypeLabel: '', bodyLines: [] };
            }
            ensureNodeInCorrectGroup(to, toResolved.isRoot);
          }
        } else if (lollipopTo && nodesById[to]) {
          nodesById[to].stereotype = 'circle';
        }

        let edgeType;
        let resolvedMeta;
        try {
          resolvedMeta = normalizeArrowMeta(arrowMeta, arrow);
          edgeType = arrowToEdgeType(arrow, arrowMeta);
        } catch (error) {
          if (strict) {
            throw new Error(`Unsupported class arrow at line ${i}: ${st.raw || ''}`);
          }
          continue;
        }

        // PlantUML convention: single-dash edges (length=1) without explicit direction
        // are horizontal by default (same rank constraint).
        let edgeDirection = resolvedMeta?.direction || null;
        const edgeLength = resolvedMeta?.length || 1;
        if (!edgeDirection && edgeLength === 1) {
          edgeDirection = 'right';
        }

        edges.push({
          id: `e${edges.length + 1}`,
          type: edgeType,
          from: edgeFrom,
          to: edgeTo,
          label,
          arrow,
          arrowMeta,
          cardFrom: st.cardFrom ? String(st.cardFrom).trim() : undefined,
          cardTo: st.cardTo ? String(st.cardTo).trim() : undefined,
          style: st.style || null,
          fromPort: fromPort || undefined,
          toPort: toPort || undefined,
          direction: edgeDirection,
          length: edgeLength,
        });
        lastEdgeId = edges[edges.length - 1].id;
        continue;
      }

      const isClassDeclToken = st && st.kind === 'class_declaration';

      if (isClassDeclToken) {
        const isAbstract = Boolean(st.abstract) || declType === 'abstract';
        const kind = (declType === 'object') ? 'class'
          : (declType === 'abstract') ? 'class'
          : declType;
        let rawToken = String(st.name || st.label || st.alias || '');
        // Use tags array emitted by PEG grammar (ClassDeclLine variant 3).
        const stTags: string[] = Array.isArray(st.tags) ? st.tags : [];
        // Use the stereotypes array emitted by the PEG grammar.
        // Each element is either a plain string or { text, spot: { char, color } }.
        const cleanName = rawToken;
        const generic: string | undefined = st.generic || undefined;
        let customSpot: { char: string; color: string } | undefined;
        const stereoTexts: string[] = [];
        for (const s of (st.stereotypes || [])) {
          if (typeof s === 'string') {
            stereoTexts.push(s);
          } else if (s && typeof s === 'object') {
            if (s.spot) customSpot = s.spot;
            if (s.text) stereoTexts.push(s.text);
          }
        }
        const stereotypeLabel = stereoTexts.map((s: string) => `«${s}»`).join(' ');
        // Resolve name in namespace context
        const nameResolved = resolveNameInScope(cleanName);
        const resolvedName = nameResolved.resolved;
        // Extract short name using the configured namespace separator
        let shortName: string;
        if (namespaceSeparator && resolvedName.includes(namespaceSeparator)) {
          shortName = resolvedName.split(namespaceSeparator).pop()!;
        } else {
          shortName = resolvedName;
        }
        // When PEG emits aliasIsLabel, the alias carries the display name.
        // e.g. class ID as "Display Name" → aliasIsLabel=true, name=ID, alias="Display Name"
        // vs.  class "Display Name" as ID → name="Display Name", alias=ID (no aliasIsLabel)
        const aliasIsLabel = Boolean(st.aliasIsLabel);
        const label = aliasIsLabel ? st.alias : shortName;
        const id = normalizeId(aliasIsLabel ? resolvedName : (st.alias || resolvedName));
        const hasBrace = Boolean(st.block);

        const nodeType = kind === 'interface' && !st.shortForm ? NodeType.Interface : kind === 'enum' ? NodeType.Enum
          : (st.implicit && (isUsecaseContext || isDescriptionContext)) ? NodeType.UsecaseActor : NodeType.Class;

        const bodyLines: BodyLine[] = [];

        if (hasBrace) {
          // Consume class_body_line statements until class_block_end
          while (i + 1 < statements.length) {
            i++;
            const innerSt = statements[i];
            if (!innerSt || typeof innerSt !== 'object') continue;
            if (innerSt.kind === 'block_statement' && innerSt.type === 'class_block_end') break;
            if (innerSt.kind !== 'class_body_line') continue;
            const inner = String(innerSt.text || innerSt.raw || '').trim();
            if (!inner) continue;
            if (inner.charAt(0) === "'") continue;

            // Check for {field}/{method} tagged member from PEG
            if (innerSt.tag) {
              const vis = innerSt.visibility || '';
              const cleaned = (vis + (innerSt.memberText || inner)).trim();
              if (cleaned) bodyLines.push({ text: cleaned, tag: innerSt.tag });
              continue;
            }

            // Prepend visibility character (-/+/#/~) when stored separately by PEG
            const vis = innerSt.visibility || '';
            bodyLines.push(vis ? vis + inner : inner);
          }
        }

        if (!nodesById[id]) nodeOrder.push(id);
        nodesById[id] = {
          id,
          type: nodeType,
          label,
          stereotype: isAbstract ? 'abstract' : declType === 'object' ? 'object' : (st.implicit && (isUsecaseContext || isDescriptionContext)) ? 'actor' : kind === 'interface' ? ((st.shortForm || isDeploymentContext) ? 'circle' : 'interface') : kind,
          stereotypeLabel,
          bodyLines,
          style: st.style || null,
          tags: stTags.length > 0 ? stTags : undefined,
          spot: customSpot,
          generic,
        };
        ensureNodeInCorrectGroup(id, nameResolved.isRoot);
        lastDefinedClass = id;

        // Handle "class A implements B" / "class A extends B"
        if (st.relation && st.relationTarget) {
          const targetId = normalizeId(st.relationTarget);
          if (targetId) {
            // Ensure target node exists (implicit declaration)
            if (!nodesById[targetId]) {
              nodeOrder.push(targetId);
              const targetType = st.relation === 'implements' ? NodeType.Interface : NodeType.Class;
              const targetStereo = st.relation === 'implements' ? 'interface' : 'class';
              nodesById[targetId] = {
                id: targetId,
                type: targetType,
                label: st.relationTarget,
                stereotype: targetStereo,
                stereotypeLabel: '',
                bodyLines: [],
              };
            }
            // Create edge: child --▷ parent (inheritance/implementation)
            // Direction 'up' ensures parent appears above child in layout
            const edgeId = `e${edges.length + 1}`;
            const edgeType = st.relation === 'implements' ? EdgeType.Implementation : EdgeType.Inheritance;
            edges.push({
              id: edgeId,
              from: id,
              to: targetId,
              type: edgeType,
              label: '',
              direction: 'up',
            });
          }
        }

        continue;
      }

      // State declaration: "state ForkState <<fork>>" → declaration_statement|state
      if (st.kind === 'declaration_statement' && declType === 'state') {
        const rawName = String(st.name || st.alias || '').trim();
        const label = String(st.label || rawName);
        const id = normalizeId(st.alias || rawName);
        const stereotypes: string[] = Array.isArray(st.stereotypes) ? st.stereotypes : [];
        const stereo = stereotypes[0] || '';

        // Map stereotypes to NodeType
        let nodeType: (typeof NodeType)[keyof typeof NodeType] = NodeType.State;
        const portDirection = PORT_STEREOTYPE_MAP[stereo];
        if (portDirection) nodeType = NodeType.Class; // port nodes use Class type
        else if (stereo === 'fork') nodeType = NodeType.StateFork;
        else if (stereo === 'join') nodeType = NodeType.StateJoin;
        else if (stereo === 'choice') nodeType = NodeType.StateChoice;
        else if (stereo === 'start') nodeType = NodeType.StateStart;
        else if (stereo === 'end') nodeType = NodeType.StateEnd;

        if (portDirection) {
          // Port node: entry/exit point on state boundary
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: nodeType,
            label,
            stereotype: portDirection,
            stereotypeLabel: '',
            bodyLines: [],
            style: st.style || null,
            isPort: true,
            portType: portDirection,
          };
          registerNodeInGroup(id);
          continue;
        }

        if (st.block) {
          // Composite state: the state node IS the group container.
          // Use the node ID as the group ID so compound edges route correctly.
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: nodeType,
            label,
            stereotype: stereo || null,
            stereotypeLabel: stereo || '',
            bodyLines: [],
            style: st.style || null,
          };
          const parentGroup = groupStack.length > 0 ? groupStack[groupStack.length - 1] : undefined;
          const parentId = parentGroup?.id;
          // Reuse existing group if already created (state defined in multiple blocks)
          let stateGroup = groups.find(g => g.id === id);
          if (!stateGroup) {
            // The explicit block definition determines the real parent.
            // Remove from any group that auto-registered this id via edge references.
            for (const g of groups) {
              const idx = g.children.indexOf(id);
              if (idx !== -1) g.children.splice(idx, 1);
            }
            stateGroup = {
              id,
              label,
              type: 'state',
              parentId,
              children: [],
              childGroups: [],
            };
            groups.push(stateGroup);
            if (parentGroup && !parentGroup.childGroups.includes(id)) {
              parentGroup.childGroups.push(id);
            }
          }
          groupStack.push(stateGroup);
          blockPushCounts.push(1);
        } else {
          // Simple state (no block)
          const bodyLines: BodyLine[] = [];
          // Inline colon-text: "state NAME : text" or "state ... as ID : text"
          // The PEG FreeText tail captures ": text" including the colon prefix;
          // strip it before adding to bodyLines.
          const inlineText = String(st.text || '').replace(/^:\s*/, '').trim();
          if (inlineText) bodyLines.push(inlineText);
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = {
            id,
            type: nodeType,
            label,
            stereotype: stereo || null,
            stereotypeLabel: stereo || '',
            bodyLines,
            style: st.style || null,
          };
          registerNodeInGroup(id);
        }
        continue;
      }

      // Diamond short-form: "<> name"
      if (st.kind === 'generic_statement' && st.type === 'diamond_short_form') {
        const rawLabel = String(st.text || st.name || st.right || st.label || '');
        const label = rawLabel;
        const id = normalizeId(rawLabel);
        if (id && !nodesById[id]) {
          nodeOrder.push(id);
          nodesById[id] = { id, type: NodeType.Class, label, stereotype: 'diamond', stereotypeLabel: '', bodyLines: [] };
          registerNodeInGroup(id);
        }
        continue;
      }

      // Fallback: "entity Foo" via TwoColumnLine / TypedMemberLine
      // (entity overlaps with ComponentType and sequence participant keywords,
      // so it cannot be in BareTypeKeyword)
      if (
        (st.kind === 'generic_statement' && st.type === 'two_column' && String(st.left || '').toLowerCase() === 'entity') ||
        (st.kind === 'declaration_statement' && declType === 'member' && String(st.dataType || '').toLowerCase() === 'entity')
      ) {
        const rawLabel = String(st.right || st.name || '');
        const label = rawLabel;
        const id = normalizeId(rawLabel);
        if (id) {
          if (!nodesById[id]) nodeOrder.push(id);
          nodesById[id] = { id, type: NodeType.Class, label, stereotype: 'entity-class', stereotypeLabel: '', bodyLines: [] };
          registerNodeInGroup(id);
          lastDefinedClass = id;
        }
        continue;
      }

      // Member colon syntax: "Object : equals()" → declaration_statement|member with owner + text
      if (st.kind === 'declaration_statement' && declType === 'member' && st.owner) {
        const ownerId = normalizeId(st.owner);
        const text = String(st.text || '').trim();
        if (ownerId) {
          if (!nodesById[ownerId]) {
            nodeOrder.push(ownerId);
            nodesById[ownerId] = { id: ownerId, type: defaultNodeType, label: ownerId, stereotype: null, stereotypeLabel: '', bodyLines: [] };
            registerNodeInGroup(ownerId);
          }
          if (text) {
            const node = nodesById[ownerId];
            if (!node.bodyLines) node.bodyLines = [];
            node.bodyLines.push(text);
          }
        }
        continue;
      }
    }
  }

  // ── Post-processing: disambiguate (*) start vs end ──────────────────
  if (nodesById['(*)']) {
    if (starAsSourceCount > 0 && starAsTargetCount > 0) {
      // (*) used as both source and target → split into separate start/end nodes
      nodesById['(*)'].type = NodeType.StateStart as any;
      const endId = '__activity_end__';
      nodesById[endId] = {
        id: endId,
        type: NodeType.StateEnd as any,
        label: '',
        stereotype: null,
        stereotypeLabel: '',
        bodyLines: [],
      };
      nodeOrder.push(endId);
      // Rewrite edges: edges TO (*) should point to end node
      for (const e of edges) {
        if (e.to === '(*)') e.to = endId;
      }
      // Rewrite note targets: notes targeting (*) should point to end node
      for (const n of notes) {
        if (n.target === '(*)') n.target = endId;
      }
    } else if (starAsTargetCount > 0) {
      nodesById['(*)'].type = NodeType.StateEnd as any;
    } else {
      nodesById['(*)'].type = NodeType.StateStart as any;
    }
  }

  // Apply hide/show visibility rules to each node.
  // Rules are applied in order; later rules override earlier ones.
  // We only set flags here; the renderer decides how to display.
  if (visRules.length > 0) {
    /** Check if a visibility rule scope matches a node. */
    const scopeMatches = (scope: string, nodeId: string, stereotypes: string[]): boolean => {
      if (scope === '*') return true;
      // Stereotype scope: <<Name>>
      const stereoMatch = scope.match(/^<<(.+)>>$/);
      if (stereoMatch) {
        return stereotypes.includes(stereoMatch[1]);
      }
      // Node id match
      return normalizeId(scope) === nodeId;
    };

    for (const id of Object.keys(nodesById)) {
      const node = nodesById[id];
      if (!node) continue;
      // Extract stereotypes from stereotypeLabel (e.g. '«Serializable»' → ['Serializable'])
      const stereotypes: string[] = [];
      if (node.stereotypeLabel) {
        const re = /[«]([^»]+)[»]/g;
        let m;
        while ((m = re.exec(node.stereotypeLabel))) stereotypes.push(m[1]);
      }

      // Compute effective visibility per aspect by replaying rules in order.
      // Start with defaults: everything visible.
      let showFields = true, showMethods = true, showCircle = true;
      for (const rule of visRules) {
        if (!scopeMatches(rule.scope, id, stereotypes)) continue;
        const val = rule.action === 'show';
        switch (rule.aspect) {
          case 'members':  showFields = val; showMethods = val; break;
          case 'fields':   showFields = val; break;
          case 'methods':  showMethods = val; break;
          case 'circle':   showCircle = val; break;
        }
      }

      // Set visibility flags on the node — the renderer handles filtering.
      if (!showFields) node.hideFields = true;
      if (!showMethods) node.hideMethods = true;
      if (!showCircle) node.hideCircle = true;
    }
  }

  // Build set of node ids that appear in at least one edge (linked nodes).
  const linkedNodes = new Set<string>();
  for (const e of edges) {
    linkedNodes.add(e.from);
    linkedNodes.add(e.to);
  }

  // Compute per-node removal by replaying removeRules in order.
  // A node is removed if the last matching rule is 'remove'.
  function isNodeRemoved(id: string, node: SemanticNode | undefined): boolean {
    let removed = false;
    for (const rule of removeRules) {
      if (rule.target === '*') {
        removed = rule.action === 'remove';
      } else if (rule.target === '@unlinked') {
        if (!linkedNodes.has(id)) {
          removed = rule.action === 'remove';
        }
      } else if (rule.target.startsWith('$')) {
        if (node?.tags?.includes(rule.target)) {
          removed = rule.action === 'remove';
        }
      } else {
        if (id === rule.target) {
          removed = rule.action === 'remove';
        }
      }
    }
    return removed;
  }

  // Remove auto-created class nodes that share an id with a note alias.
  // Note aliases (e.g. "note ... as N1") are valid edge endpoints but should
  // NOT be rendered as class swimlanes.
  const noteIds = new Set(notes.map((n) => n.id));
  const filteredNodeOrder = nodeOrder.filter((id) => {
    if (noteIds.has(id)) return false;
    if (isNodeRemoved(id, nodesById[id])) return false;
    return true;
  });

  // Filter edges that reference removed/hidden nodes (but NOT note aliases)
  const removedNodeSet = new Set<string>();
  for (const id of nodeOrder) {
    if (isNodeRemoved(id, nodesById[id])) removedNodeSet.add(id);
  }
  const filteredEdges = edges.filter(e => !removedNodeSet.has(e.from) && !removedNodeSet.has(e.to));

  // Apply <style> CSS rules to nodes that don't have explicit inline styles.
  // Convert CSS properties (BackGroundColor, LineColor, LineThickness) to inline style format.
  if (Object.keys(cssStyleRules).length > 0) {
    // Find global rules (e.g., "componentDiagram") that apply to all nodes
    const globalSelectors = ['componentdiagram', 'classdiagram', 'objectdiagram',
      'usecasediagram', 'statediagram', 'deploymentdiagram'];
    let globalRule: Record<string, string> | null = null;
    for (const gs of globalSelectors) {
      if (cssStyleRules[gs]) { globalRule = cssStyleRules[gs]; break; }
    }

    // Helper: build inline style string from CSS rule properties.
    // For label shapes, BackGroundColor maps to text color (label has no fill).
    // skipBg: when true, BackGroundColor is ignored (e.g. global rule on label).
    const buildInlineStyle = (rule: Record<string, string>, stereo?: string, skipBg?: boolean): string | null => {
      const parts: string[] = [];
      const bg = rule['backgroundcolor'];
      if (bg && !skipBg) {
        if (stereo === 'label') parts.push(`text:${bg}`);
        else parts.push(`back:${bg}`);
      }
      const lc = rule['linecolor'];
      if (lc) parts.push(`line:${lc}`);
      const lt = rule['linethickness'];
      if (lt && parseInt(lt) >= 2) parts.push('line.bold');
      const tc = rule['fontcolor'];
      if (tc) parts.push(`text:${tc}`);
      return parts.length > 0 ? '#' + parts.join(';') : null;
    }

    for (const id of nodeOrder) {
      const node = nodesById[id];
      if (!node || node.style) continue; // skip nodes with explicit inline style
      const stereo = String(node.stereotype || '').toLowerCase().replace(/\/$/, '');
      // In PlantUML, 'circle' is an alias for 'interface' — use interface CSS rule
      // 'choice' renders as a diamond shape — use diamond CSS rule
      const lookupStereo = stereo === 'circle' ? 'interface'
        : stereo === 'choice' ? 'diamond'
        : stereo;
      // Also resolve CSS class rules (.stereo) matched against custom stereotype labels («stereo» -> 'stereo')
      const customStereos = node.stereotypeLabel
        ? String(node.stereotypeLabel).split(/[\s«»]+/).map((s: string) => s.toLowerCase()).filter(Boolean)
        : [];
      const specificRule = cssStyleRules[lookupStereo]
        || customStereos.reduce((r: Record<string, string> | null, cs: string) => r || cssStyleRules[cs] || null, null)
        || (lookupStereo ? null : cssStyleRules[String(node.type || '').toLowerCase()]);
      const rule = specificRule || globalRule;
      if (!rule) continue;
      // For label shapes, only apply BackGroundColor→text from a label-specific rule,
      // not from global diagram rules (label is text-only, no fill).
      const skipBg = stereo === 'label' && !specificRule;
      const s = buildInlineStyle(rule, stereo, skipBg);
      if (s) node.style = s;
    }

    // Apply to groups — type-specific CSS rules first, then global diagram rule as fallback.
    // PlantUML converts empty groups to leaf entities that don't match global selectors,
    // so only apply globalRule to groups that contain children.
    for (const g of groups) {
      if (g.color && g.style) continue;
      const gtype = String(g.type || '').toLowerCase();
      // Also check CSS class rules (.stereo) matched against group's custom stereotype labels
      const gCustomStereos: string[] = g.stereotype
        ? String(g.stereotype).split(/[«»\s]+/).map((x: string) => x.toLowerCase()).filter(Boolean)
        : [];
      const hasChildren = g.children.length > 0 || g.childGroups.length > 0;
      const rule = cssStyleRules[gtype]
        || gCustomStereos.reduce((r: Record<string, string> | null, cs: string) => r || cssStyleRules[cs] || null, null)
        || (hasChildren ? globalRule : null);
      if (!rule) continue;
      if (!g.color) {
        const bg = rule['backgroundcolor'];
        if (bg) g.color = bg;
      }
      if (!g.style) {
        const s = buildInlineStyle(rule);
        if (s) g.style = s;
      }
    }
  }

  // Apply global skinparam packageStyle as default stereotype for groups
  // that don't have an explicit stereotype, so renderers don't need global context.
  // Only applies to 'package' and 'namespace' groups — explicit types like
  // 'folder', 'frame', 'cloud' etc. keep their own shape.
  const packageStyle = skinparams['packageStyle'] || '';
  if (packageStyle) {
    const PACKAGE_STYLE_TYPES = new Set(['package', 'namespace', '']);
    for (const g of groups) {
      if (!g.stereotype && PACKAGE_STYLE_TYPES.has(g.type)) g.stereotype = packageStyle;
    }
  }

  // Apply skinparam type-specific colors to groups (e.g. skinparam node { BackgroundColor ... })
  for (const g of groups) {
    const gtype = String(g.type || '').toLowerCase();
    const bg = skinparams[gtype + 'BackgroundColor'];
    const border = skinparams[gtype + 'BorderColor'];
    if (!g.color && bg) g.color = bg;
    if (border && !g.style) {
      g.style = `#line:${border}`;
    }
  }

  // Apply skinparam type-specific colors to leaf nodes (e.g. skinparam artifact { ... })
  for (const id of nodeOrder) {
    const node = nodesById[id];
    if (!node || node.style) continue;
    let ntype = String(node.stereotype || '').toLowerCase().replace(/\/$/, '');
    // Plain state nodes often have no stereotype; map by semantic type so
    // skinparam state { BackgroundColor/BorderColor } still applies.
    if (!ntype && node.type === NodeType.State) ntype = 'state';
    if (!ntype) continue;
    const bg = skinparams[ntype + 'BackgroundColor'];
    const border = skinparams[ntype + 'BorderColor'];
    if (bg || border) {
      const parts: string[] = [];
      if (bg) parts.push(`back:${bg}`);
      if (border) parts.push(`line:${border}`);
      node.style = '#' + parts.join(';');
    }
  }

  // Resolve note targets that match group aliases to actual group ids
  for (const n of notes) {
    if (!n.target) continue;
    const targetGroup = groups.find(g =>
      (g.alias && normalizeId(g.alias) === n.target) ||
      normalizeId(g.label) === n.target
    );
    if (targetGroup) n.target = targetGroup.id;
  }

  return {
    diagramType: DiagramType.UML,
    nodes: filteredNodeOrder.map((id) => nodesById[id]),
    edges: filteredEdges,
    notes,
    groups,
    errors,
    rankdir,
    title,
    legend: legend || undefined,
    skinparams: Object.keys(skinparams).length > 0 ? skinparams : undefined,
  };
}
