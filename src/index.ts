import { dispatch } from './dispatcher.ts';
import { parseClassDiagram } from './parsers/class.ts';
import { parseSequenceDiagram } from './parsers/sequence.ts';
import { parsePlantUml } from './parsers/puml.ts';
import { preprocess } from './shared/preprocessor.ts';
import { dotLayoutSync } from './layout/dot-layout.ts';
import { sequenceTableLayout } from './layout/table-layout.ts';
import { semanticToDrawioXml } from './generator/drawio-gen.ts';
import { sequenceToDrawioXml } from './generator/sequence-gen.ts';
import { DiagramType } from './model/index.ts';

// Re-export init helper so callers can pre-warm viz.js
export { dotLayout, initViz } from './layout/dot-layout.ts';
export type { DotLayoutResult } from './layout/dot-layout.ts';

export function textToDrawioXml(dsl) {
  const { diagramType, body, parsed } = dispatch(dsl);
  const { source, pragmas } = preprocess(body);

  if (diagramType === DiagramType.Sequence) {
    const model = parseSequenceDiagram(source, { strict: true });
    const { renderers, ...layout } = sequenceTableLayout(model);
    return sequenceToDrawioXml(model, layout, renderers);
  }

  const model = parseClassDiagram(parsed.statements, { pragmas });
  model.diagramType = diagramType;

  const { layout, renderers } = dotLayoutSync(model);
  return semanticToDrawioXml(model, layout, renderers);
}

export function parsePumlToJson(dsl) {
  return parsePlantUml(dsl);
}

export { dispatch } from './dispatcher.ts';
export * from './model/index.ts';
export { parsePlantUml } from './parsers/puml.ts';
export { parseSequenceDiagram } from './parsers/sequence.ts';
