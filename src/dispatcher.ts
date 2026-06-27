import { DiagramType } from './model/index.ts';
import { parsePlantUml } from './parsers/puml.ts';
import { parse as parsePeggy } from './parsers/puml-peggy.ts';
import { detectDiagramContext } from './detect-context.ts';
export type { DiagramContext } from './detect-context.ts';
export { detectDiagramContext } from './detect-context.ts';

function parseDirectiveLine(kind, rawLine) {
  const input = `${String(rawLine || '')}\n`;
  try {
    if (kind === 'start') return parsePeggy(input, { startRule: 'StartDirectiveLine' });
    if (kind === 'end') return parsePeggy(input, { startRule: 'EndDirectiveLine' });
    return null;
  } catch {
    return null;
  }
}

export function stripStartEnd(dsl) {
  const text = String(dsl || '');
  const lines = text.split(/\r?\n/);

  let startIdx = 0;
  let endIdx = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const d = parseDirectiveLine('start', lines[i]);
    if (d) {
      startIdx = i + 1;
      break;
    }
  }

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const d = parseDirectiveLine('end', lines[i]);
    if (d) {
      endIdx = i;
      break;
    }
  }

  const body = lines.slice(startIdx, endIdx).join('\n');
  return body;
}

export function dispatch(dsl) {
  const text = String(dsl || '');
  const parsed = parsePlantUml(text);
  const body = stripStartEnd(text);
  const diagramContext = detectDiagramContext(parsed);

  // Detect diagram type from start directive or context
  let diagramType;
  if (parsed.startDirective && parsed.startDirective.toLowerCase() === '@startmindmap') {
    diagramType = DiagramType.Mindmap;
  } else if (parsed.startDirective && parsed.startDirective.toLowerCase() === '@startgantt') {
    diagramType = DiagramType.Gantt;
  } else if (diagramContext === 'sequence') {
    diagramType = DiagramType.Sequence;
  } else {
    diagramType = DiagramType.UML;
  }

  return { diagramType, body, parsed, diagramContext };
}
