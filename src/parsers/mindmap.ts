/**
 * Mindmap diagram parser.
 *
 * Converts raw mindmap statements (from puml.ts mindmap mode) into a
 * MindmapModel tree structure ready for layout and rendering.
 */

export interface MindmapNode {
  id: string;
  label: string;
  level: number;
  /** Side: 'left' or 'right'. Root is 'right'. */
  side: 'left' | 'right';
  /** Boxless node (underscore suffix): renders without a box. */
  boxless: boolean;
  /** Inline background color, e.g. '#Orange'. */
  color: string | null;
  /** Stereotype class name for style lookup. */
  stereotype: string | null;
  /** Child nodes. */
  children: MindmapNode[];
}

export interface MindmapModel {
  diagramType: 'mindmap';
  /** Root nodes (typically one, but PlantUML allows multiple roots). */
  roots: MindmapNode[];
  /** Layout direction: 'LR' (default) or 'TB'. */
  direction: 'LR' | 'TB' | 'RL';
  /** Diagram title. */
  title?: string;
  /** Diagram caption. */
  caption?: string;
}

export interface ParseMindmapOptions {
  pragmas?: Record<string, string>;
}

export function parseMindmapDiagram(statements: any[], _options?: ParseMindmapOptions): MindmapModel {
  const roots: MindmapNode[] = [];
  let nodeCounter = 0;
  let currentSide: 'left' | 'right' = 'right';
  let direction: 'LR' | 'TB' | 'RL' = 'LR';
  let title: string | undefined;
  let caption: string | undefined;

  // Parse <style> blocks into style config
  const styleConfig: MindmapStyleConfig = {
    classes: new Map(), wildcardClasses: new Set(),
    nodeDefault: null, depthColors: new Map(),
  };
  for (const st of statements) {
    if (st.kind === 'mindmap_style_block' && st.text) {
      const cfg = parseStyleBlock(st.text);
      for (const [k, v] of cfg.classes) styleConfig.classes.set(k, v);
      for (const c of cfg.wildcardClasses) styleConfig.wildcardClasses.add(c);
      if (cfg.nodeDefault) styleConfig.nodeDefault = cfg.nodeDefault;
      for (const [k, v] of cfg.depthColors) styleConfig.depthColors.set(k, v);
    }
  }

  // Collect node statements first to detect indentation-based leveling
  const nodeStatements: any[] = [];
  for (const st of statements) {
    if (st.kind === 'mindmap_node_line') nodeStatements.push(st);
  }

  // Detect indentation-based leveling: if ALL nodes have marker length 1
  // and there are nodes with different indentation, use indentation for levels.
  const allSingleMarker = nodeStatements.length > 0 && nodeStatements.every(st => st.level === 1);
  const hasVaryingIndent = allSingleMarker && nodeStatements.some(st => (st.indent || 0) > 0);
  let indentLevels: number[] | null = null;

  if (allSingleMarker && hasVaryingIndent) {
    // Build sorted unique indent values to map indent -> level
    const indents = [...new Set(nodeStatements.map(s => s.indent || 0))].sort((a, b) => a - b);
    indentLevels = indents;
  }

  // Stack tracks the current branch path for parent lookup.
  // Each entry is { node, level }.
  const stack: Array<{ node: MindmapNode; level: number }> = [];

  for (const st of statements) {
    if (st.kind === 'blank_line' || st.kind === 'comment_line') continue;

    if (st.kind === 'mindmap_side') {
      currentSide = st.side;
      continue;
    }

    if (st.kind === 'mindmap_direction') {
      const d = String(st.direction || '').toLowerCase();
      if (d.includes('top to bottom')) direction = 'TB';
      else if (d.includes('right to left')) direction = 'RL';
      else direction = 'LR';
      continue;
    }

    if (st.kind === 'mindmap_title') {
      title = st.text;
      continue;
    }

    if (st.kind === 'mindmap_caption') {
      caption = st.text;
      continue;
    }

    if (st.kind === 'mindmap_style_block') {
      // Style blocks are ignored for now — could be parsed later.
      continue;
    }

    if (st.kind === 'mindmap_text_line') {
      // Ignore non-node text lines (header/footer/legend etc.)
      continue;
    }

    if (st.kind !== 'mindmap_node_line') continue;

    // Compute effective level
    let level: number;
    if (indentLevels) {
      // Indentation-based: map indent to level index + 1
      const indent = st.indent || 0;
      level = indentLevels.indexOf(indent) + 1;
    } else {
      level = st.level;
    }
    const marker: string = st.marker || '*';

    // Determine side for this node
    let side: 'left' | 'right';
    if (st.side) {
      side = st.side;
    } else if (marker === '-') {
      side = 'left';
    } else if (marker === '+') {
      side = 'right';
    } else {
      // * and # follow current side context
      side = currentSide;
    }

    const stereo = st.stereotype || null;
    // Resolve color priority: inline [#Color] > stereotype class > :depth(N) > node default
    let color = st.color || null;
    if (!color && stereo && styleConfig.classes.has(stereo)) {
      color = styleConfig.classes.get(stereo)!;
    }
    // :depth(N) is 0-based in PlantUML (root=0), our level is 1-based
    const depth = level - 1;
    if (!color && styleConfig.depthColors.has(depth)) {
      color = styleConfig.depthColors.get(depth)!;
    }
    if (!color && styleConfig.nodeDefault) {
      color = styleConfig.nodeDefault;
    }

    const node: MindmapNode = {
      id: `mm_${++nodeCounter}`,
      label: st.text || '',
      level,
      side,
      boxless: Boolean(st.boxless),
      color,
      stereotype: stereo,
      children: [],
    };

    if (level === 1) {
      // Root node
      roots.push(node);
      stack.length = 0;
      stack.push({ node, level: 1 });
      // Root is always 'right' side conceptually
      node.side = 'right';
    } else {
      // Find parent: walk back the stack to find the nearest ancestor at level - 1
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length > 0) {
        const parent = stack[stack.length - 1].node;
        // If this is a direct child of root, inherit the side
        if (parent.level === 1 && level === 2) {
          // Keep the determined side
        } else {
          // Non-root children inherit parent's side
          node.side = parent.side;
        }
        parent.children.push(node);
      } else {
        // Orphan node (no valid parent), treat as root
        roots.push(node);
      }
      stack.push({ node, level });
    }
  }

  // Post-process: propagate wildcard class colors to descendants
  if (styleConfig.wildcardClasses.size > 0) {
    function propagateWildcard(node: MindmapNode, inheritedColor: string | null) {
      // If this node has a wildcard class, start propagating its color
      if (node.stereotype && styleConfig.wildcardClasses.has(node.stereotype)) {
        inheritedColor = styleConfig.classes.get(node.stereotype) || inheritedColor;
      }
      for (const child of node.children) {
        // Apply inherited color to children without their own explicit color
        if (inheritedColor && !child.color) {
          child.color = inheritedColor;
        }
        propagateWildcard(child, inheritedColor);
      }
    }
    for (const root of roots) propagateWildcard(root, null);
  }

  return { diagramType: 'mindmap', roots, direction, title, caption };
}

// ── Style config ─────────────────────────────────────────────────────────────

interface MindmapStyleConfig {
  /** .className → BackgroundColor */
  classes: Map<string, string>;
  /** .className with wildcard (*) — propagates to descendants */
  wildcardClasses: Set<string>;
  /** node { BackgroundColor } — default for all nodes */
  nodeDefault: string | null;
  /** :depth(N) { BackgroundColor } — per-depth override */
  depthColors: Map<number, string>;
}

// ── Style block parser ───────────────────────────────────────────────────────

function normalizeStyleColor(val: string): string {
  return val.startsWith('#') ? val : `#${val}`;
}

/**
 * Parse a mindmap <style> block into a MindmapStyleConfig.
 * Supports:
 *   .className { BackgroundColor value }
 *   .className * { BackgroundColor value }   (wildcard — propagate to descendants)
 *   node { BackgroundColor value }           (default for all nodes)
 *   :depth(N) { BackgroundColor value }      (per-depth override)
 */
function parseStyleBlock(text: string): MindmapStyleConfig {
  const config: MindmapStyleConfig = {
    classes: new Map(),
    wildcardClasses: new Set(),
    nodeDefault: null,
    depthColors: new Map(),
  };

  // Class selectors: .className [*] { ... }
  const classRe = /\.(\w+)\s*(\*)?\s*\{([^}]*)}/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(text)) !== null) {
    const className = m[1];
    const wildcard = m[2] === '*';
    const body = m[3];
    const bgMatch = body.match(/BackgroundColor\s+(\S+)/i);
    if (bgMatch) {
      config.classes.set(className, normalizeStyleColor(bgMatch[1]));
      if (wildcard) config.wildcardClasses.add(className);
    }
  }

  // Element selector: node { ... }
  const nodeRe = /\bnode\s*\{([^}]*)}/g;
  while ((m = nodeRe.exec(text)) !== null) {
    const bgMatch = m[1].match(/BackgroundColor\s+(\S+)/i);
    if (bgMatch) config.nodeDefault = normalizeStyleColor(bgMatch[1]);
  }

  // Depth selector: :depth(N) { ... }
  const depthRe = /:depth\((\d+)\)\s*\{([^}]*)}/g;
  while ((m = depthRe.exec(text)) !== null) {
    const depth = parseInt(m[1], 10);
    const bgMatch = m[2].match(/BackgroundColor\s+(\S+)/i);
    if (bgMatch) config.depthColors.set(depth, normalizeStyleColor(bgMatch[1]));
  }

  return config;
}
