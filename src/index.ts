import { dispatch } from './dispatcher.ts';
import { parseClassDiagram } from './parsers/class.ts';
import { parseActivityDiagram } from './parsers/activity.ts';
import { parseSequenceDiagram } from './parsers/sequence.ts';
import { parsePlantUml } from './parsers/puml.ts';
import { preprocess } from './shared/preprocessor.ts';
import { dotLayout } from './layout/dot-layout.ts';
import { elkLayout } from './layout/elk/elk-engine.ts';
import { sequenceTableLayout } from './layout/table-layout.ts';
import { semanticToDrawioXml } from './generator/drawio-gen.ts';
import { sequenceToDrawioXml } from './generator/sequence-gen.ts';
import { DiagramType } from './model/index.ts';
import { clearRenderWarnings, getRenderWarnings } from './primitives/index.ts';
import type { ThemeConfig, Theme } from './shared/theme.ts';
import { createTheme } from './shared/theme.ts';

// Re-export init helper so callers can pre-warm viz.js
export { dotLayout, initViz } from './layout/dot-layout.ts';
export type { DotLayoutResult } from './layout/dot-layout.ts';

// Re-export ELK layout
export { elkLayout } from './layout/elk/elk-engine.ts';
export type { ElkLayoutResult } from './layout/elk/elk-engine.ts';

// Re-export render warning API for external consumers
export { getRenderWarnings, clearRenderWarnings } from './primitives/index.ts';
export type { RenderWarning } from './primitives/index.ts';

/** Layout engine name. */
export type LayoutEngine = 'dot' | 'elk';

/** Options for textToDrawioXml. */
export interface ConvertOptions {
  /** Layout engine to use. Default: 'dot'. */
  engine?: LayoutEngine;
  /** Theme configuration. Default: computed from fontSize=12. */
  theme?: ThemeConfig;
}

export async function textToDrawioXml(dsl: string, options?: ConvertOptions): Promise<string> {
  // Clear warnings from previous render pass
  clearRenderWarnings();

  const engine = options?.engine ?? 'dot';
  const theme = createTheme(options?.theme);
  const { diagramType, body, parsed, diagramContext } = dispatch(dsl);
  const { source, pragmas } = preprocess(body);

  if (diagramType === DiagramType.Sequence) {
    const model = parseSequenceDiagram(source, { strict: true });
    const { renderers, ...layout } = sequenceTableLayout(model, { theme });
    return sequenceToDrawioXml(model, layout, renderers, theme);
  }

  const model = diagramContext === 'activity'
    ? parseActivityDiagram(parsed.statements, { pragmas })
    : parseClassDiagram(parsed.statements, { pragmas, diagramContext });
  model.diagramType = diagramType;

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
