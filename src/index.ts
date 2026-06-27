import { dispatch } from './dispatcher.ts';
import { parseClassDiagram } from './parsers/class.ts';
import { parseActivityDiagram } from './parsers/activity.ts';
import { parseSequenceDiagram } from './parsers/sequence.ts';
import { parseMindmapDiagram } from './parsers/mindmap.ts';
import type { MindmapNode } from './parsers/mindmap.ts';
import { parsePlantUml } from './parsers/puml.ts';
import { preprocess } from './shared/preprocessor.ts';
import { normalizeClassModelText, normalizeSequenceModelText } from './shared/normalize-model-text.ts';
import { dotLayout } from './layout/dot-layout.ts';
import { elkLayout } from './layout/elk/elk-engine.ts';
import { sequenceTableLayout } from './layout/table-layout.ts';
import { mindmapLayout } from './layout/mindmap-layout.ts';
import { semanticToDrawioXml } from './generator/drawio-gen.ts';
import { sequenceToDrawioXml } from './generator/sequence-gen.ts';
import { mindmapToDrawioXml } from './generator/mindmap-gen.ts';
import { parseGanttStatements } from './parsers/gantt.ts';
import { ganttLayout } from './layout/gantt-layout.ts';
import { ganttToDrawioXml } from './generator/gantt-gen.ts';
import { parsePacketdiagStatements } from './parsers/packetdiag.ts';
import { packetdiagLayout } from './layout/packetdiag-layout.ts';
import { packetdiagToDrawioXml } from './generator/packetdiag-gen.ts';
import { DiagramType } from './model/index.ts';
import { clearRenderWarnings, getRenderWarnings } from './primitives/index.ts';
import { createRenderer } from './primitives/registry.ts';
import type { Renderer } from './primitives/renderer.ts';
import type { ThemeConfig, Theme } from './shared/theme.ts';
import { createTheme, createThemeFromSkinparams } from './shared/theme.ts';

// Re-export render warning API for external consumers
export { getRenderWarnings, clearRenderWarnings } from './primitives/index.ts';
export type { RenderWarning } from './primitives/index.ts';

/** Layout engine name. */
export type LayoutEngine = 'dot' | 'elk';

/** Options for textToDrawioXml. */
export interface ConvertOptions {
  /** Layout engine to use. Default: 'elk'. */
  engine?: LayoutEngine;
  /** Theme configuration. Default: computed from fontSize=12. */
  theme?: ThemeConfig;
}

export async function textToDrawioXml(dsl: string, options?: ConvertOptions): Promise<string> {
  // Clear warnings from previous render pass
  clearRenderWarnings();

  const { diagramType, body, parsed, diagramContext } = dispatch(dsl);
  const { source, pragmas } = preprocess(body);

  // Sequence diagrams always use table layout (fixed, cannot be changed)
  if (diagramType === DiagramType.Sequence) {
    const rawModel = parseSequenceDiagram(source, { strict: true });
    const theme = createThemeFromSkinparams(rawModel.skinparams, options?.theme);
    const model = normalizeSequenceModelText(rawModel, theme);
    const { renderers, ...layout } = sequenceTableLayout(model, { theme });
    return sequenceToDrawioXml(model, layout, renderers, theme);
  }

  // Mindmap diagrams use custom tree layout
  if (diagramType === DiagramType.Mindmap) {
    const theme = createTheme(options?.theme);
    const model = parseMindmapDiagram(parsed.statements, { pragmas });

    // Create a renderer for each mindmap node
    const renderers = new Map<string, Renderer>();
    function createNodeRenderers(node: MindmapNode) {
      const lines = node.label ? node.label.split('\n') : [];
      renderers.set(node.id, createRenderer(
        node.boxless ? 'mindmap-boxless' : 'mindmap-node',
        { id: node.id, label: node.label, lines, color: node.color, theme },
      ));
      for (const c of node.children) createNodeRenderers(c);
    }
    for (const root of model.roots) createNodeRenderers(root);

    const layout = mindmapLayout(model, { theme, renderers });
    return mindmapToDrawioXml(model, layout, renderers, theme);
  }

  // Gantt diagrams use custom table layout
  if (diagramType === DiagramType.Gantt) {
    const theme = createTheme(options?.theme);
    const model = parseGanttStatements(parsed.statements, pragmas);
    const { renderers, layout } = ganttLayout(model, { theme });
    return ganttToDrawioXml(model, layout, renderers, theme);
  }

  // Packetdiag diagrams use manual bit-grid layout (no DOT/ELK)
  if (diagramType === DiagramType.Packetdiag) {
    const theme = createTheme(options?.theme);
    const model = parsePacketdiagStatements(parsed.statements, pragmas);
    const { renderers, layout } = packetdiagLayout(model, { theme });
    return packetdiagToDrawioXml(model, layout, renderers, theme);
  }

  // Determine layout engine:
  // 1. Check !pragma layout directive
  // 2. Fall back to options.engine parameter
  // 3. Default to 'elk' if neither specified
  let engine: LayoutEngine = 'elk';
  
  if (pragmas.layout) {
    const layoutValue = pragmas.layout.toLowerCase();
    if (layoutValue === 'elk') {
      engine = 'elk';
    } else if (layoutValue === 'vizjs' || layoutValue === 'smetana') {
      engine = 'dot';
    }
    // Other values are ignored, keep default
  } else if (options?.engine) {
    engine = options.engine;
  }

  const rawModel = diagramContext === 'activity'
    ? parseActivityDiagram(parsed.statements, { pragmas })
    : parseClassDiagram(parsed.statements, { pragmas, diagramContext });
  const theme = createThemeFromSkinparams(rawModel.skinparams, options?.theme);
  const model = normalizeClassModelText(rawModel, theme);
  model.diagramType = diagramType;
  model.diagramContext = diagramContext;

  const { layout, renderers } = engine === 'elk'
    ? await elkLayout(model, { theme })
    : await dotLayout(model, { theme });

  return semanticToDrawioXml(model, layout, renderers, { engine, theme });
}

export function parsePumlToJson(dsl) {
  return parsePlantUml(dsl);
}

export { dispatch } from './dispatcher.ts';
export type { DiagramContext } from './detect-context.ts';
export type { ThemeConfig, Theme } from './shared/theme.ts';
export { createTheme } from './shared/theme.ts';
export * from './model/index.ts';
export { parsePlantUml } from './parsers/puml.ts';
export { parseSequenceDiagram } from './parsers/sequence.ts';
export { parseActivityDiagram } from './parsers/activity.ts';
export { parseMindmapDiagram } from './parsers/mindmap.ts';
