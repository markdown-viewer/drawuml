import { DiagramType } from './model/index.ts';
import { parsePlantUml } from './parsers/puml.ts';
import { parse as parsePeggy } from './parsers/puml-peggy.ts';

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

// --------------- Sequence diagram detection (whitelist approach) ---------------
//
// Matches PlantUML's factory priority: SequenceDiagramFactory (priority 3)
// takes precedence over ClassDiagramFactory (priority 4). A diagram is
// classified as "sequence" when:
//   1. NO statement belongs to a non-sequence category (class/activity/etc.)
//   2. At least ONE statement is a sequence-specific indicator
//
// This mirrors PlantUML's try-fail model: SequenceDiagramFactory fails when
// it encounters a line its commands cannot consume (e.g. "class Foo").

/** Statement kinds that only appear in non-sequence diagrams. */
const NON_SEQUENCE_KINDS = new Set([
  'class_body_line',
  'class_declaration',
  'json_text_line',
  'map_text_line',
  'state_body_line',
]);

/** Specific kind|type pairs that only appear in non-sequence diagrams. */
const NON_SEQUENCE_TYPES = new Set([
  // Class diagram declarations
  'class_declaration|class',
  'class_declaration|interface',
  'class_declaration|interface_old',
  'class_declaration|enum',
  'class_declaration|annotation',
  'class_declaration|object',
  'block_statement|class_block_end',
  // JSON data blocks
  'block_statement|json_block_start',
  'block_statement|json_block_end',
  // Map blocks (object diagram)
  'block_statement|map_block_start',
  'block_statement|map_block_end',
  // State diagram
  'declaration_statement|state',
  'generic_statement|bracketed_event',
  'block_statement|state_block_end',
  // Use-case diagram
  'declaration_statement|usecase',
  'declaration_statement|usecase_alias',
  'declaration_statement|usecase_actor',

  // Class diagram structure
  'block_statement|loose_block_start',
  'generic_statement|diamond_short_form',
  'generic_statement|two_column',
  // Activity diagram control flow
  'control_statement|if',
  'control_statement|elseif',
  'control_statement|else',
  'control_statement|endif',
  'control_statement|switch',
  'control_statement|case',
  'control_statement|endswitch',
  'control_statement|fork',
  'control_statement|end fork',
  'control_statement|split',
  'control_statement|while',
  'control_statement|repeat',
]);

/** Statement kinds that exclusively indicate sequence diagrams. */
const SEQUENCE_ONLY_KINDS = new Set([
  'hnote',
]);

/** Specific kind|type pairs that indicate sequence diagram. */
const SEQUENCE_INDICATOR_TYPES = new Set([
  // Participant declarations
  'declaration_statement|participant',
  'declaration_statement|mainframe',
  // Message arrows (NOTE: routing_relation handled separately — see below)
  'generic_statement|sequence_message',
  'generic_statement|sequence_start_message',
  'generic_statement|sequence_end_message',
  'generic_statement|timed_message',
  'generic_statement|async_message',
  'generic_statement|sequence_message_alias',
  'generic_statement|sequence_tagged_span',
  // Sequence-specific constructs
  'generic_statement|delay',
  'generic_statement|ellipsis',
  'block_statement|sequence_block',
  'block_statement|section',
  'block_statement|ref_single',
  'block_statement|ref_start',
  'block_statement|rnote_start',
  'block_statement|rnote_end',
  'block_statement|hnote_start',
  'block_statement|hnote_end',
  'block_statement|box_start',
  'block_statement|box_end',
  // Activation / lifecycle
  'control_statement|activate',
  'control_statement|deactivate',
  'control_statement|create',
  'control_statement|destroy',
  'activity_statement|return',
]);

/** Component types that are sequence-diagram participant stereotypes. */
const SEQUENCE_COMPONENT_TYPES = new Set([
  'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue',
]);

function looksLikeSequenceFromParsed(parsed) {
  const statements = Array.isArray(parsed?.statements) ? parsed.statements : [];
  let hasSequenceIndicator = false;

  for (const st of statements) {
    if (!st || typeof st !== 'object') continue;

    const kind = st.kind || '';
    const type = st.type || '';
    const key = kind + '|' + type;

    // Non-sequence statement found: cannot be a sequence diagram
    if (NON_SEQUENCE_KINDS.has(kind) || NON_SEQUENCE_TYPES.has(key)) {
      return false;
    }

    // Sequence-specific statement: mark as indicator
    if (SEQUENCE_ONLY_KINDS.has(kind) || SEQUENCE_INDICATOR_TYPES.has(key)) {
      hasSequenceIndicator = true;
      continue;
    }

    // Note statements need context-dependent classification:
    // - alias / on link → class-diagram only
    // - over / across   → sequence-diagram indicator
    // - note_end        → always neutral (follows a note_start)
    if (kind === 'note_start' || kind === 'note_statement') {
      if (st.alias || st.on === 'link') {
        return false; // class-diagram only construct
      }
      if (st.over || st.across) {
        hasSequenceIndicator = true;
      }
      // other note variants (e.g. "note left of X") are neutral
      continue;
    }
    if (kind === 'note_end') continue; // neutral

    // Sequence participant stereotypes (actor, boundary, etc.)
    // But if the statement has a block body (e.g. "entity Foo {"), it is a
    // class/ER declaration, not a sequence participant.
    // Also, "usecase" component types are use-case-diagram-only.
    if (kind === 'component_statement') {
      if (st.block) {
        return false;
      }
      const ct = String(st.componentType || '').toLowerCase();
      if (ct === 'usecase' || ct === 'usecase/') {
        return false;          // definitely NOT sequence (use-case diagram)
      }
      if (SEQUENCE_COMPONENT_TYPES.has(ct)) {
        hasSequenceIndicator = true;
      } else if (ct) {
        // Non-sequence component types (node, cloud, folder, etc.)
        // indicate deployment/component diagram, not sequence
        return false;
      }
    }

    // Sequence-specific arrow patterns in relation_statement
    // (e.g., ->x, -\, \\-, //-, ->o which don't appear in class diagrams)
    if (kind === 'relation_statement' && st.arrowMeta) {
      const sh = String(st.arrowMeta.startHeadToken || '');
      const eh = String(st.arrowMeta.endHeadToken || '');
      const heads = sh + eh;
      // Class-specific head decorations → NOT sequence
      if (/[|*#{}+^]/.test(heads)) {
        return false;
      }
      if (/[\\\/]/.test(heads) || /^>(x|o)$/.test(eh) || /^>>(o)$/.test(eh)) {
        hasSequenceIndicator = true;
      }
    }

    // usecase_relation: only treat as non-sequence when endpoints use
    // usecase-specific syntax ((UseCase) parens or :Actor: colon notation).
    // Plain CNAME -> CNAME arrows can appear in sequence diagrams too.
    if (key === 'generic_statement|usecase_relation') {
      const rawFrom = String(st.from || '');
      const rawTo = String(st.to || '');
      if ((rawFrom.startsWith('(') && rawFrom.endsWith(')')) ||
          (rawTo.startsWith('(') && rawTo.endsWith(')')) ||
          (rawFrom.startsWith(':') && rawFrom.endsWith(':')) ||
          (rawTo.startsWith(':') && rawTo.endsWith(':'))) {
        return false;          // definitely NOT sequence (use-case diagram)
      }
      // Plain CNAME endpoints — neutral, could be sequence
      continue;
    }

    // routing_relation: arrow with label.  Discriminate by arrow content.
    // Class-diagram arrows have decorated heads (|, *, #, +, ^) or
    // directional hints (-left->, -up->, etc.) that never appear in sequence.
    if (key === 'generic_statement|routing_relation') {
      // [*] endpoints are state-diagram-only constructs
      const rawFrom = String(st.from || '');
      const rawTo = String(st.to || '');
      if (rawFrom.startsWith('[') || rawTo.startsWith('[')) {
        return false;          // definitely NOT sequence (state diagram)
      }
      // (UseCase) endpoints are use-case-diagram-only constructs
      if ((rawFrom.startsWith('(') && rawFrom.endsWith(')')) ||
          (rawTo.startsWith('(') && rawTo.endsWith(')'))) {
        return false;          // definitely NOT sequence (use-case diagram)
      }
      const arrow = String(st.arrow || '');
      // Strip [#color] specs before checking for class-specific head decorations
      const arrowNoColor = arrow.replace(/\[#[^\]]*\]/g, '');
      if (/[|*#{}+^]/.test(arrowNoColor) || /-(?:left|right|up|down)-/i.test(arrowNoColor)) {
        return false;          // definitely NOT sequence
      }
      hasSequenceIndicator = true;
      continue;
    }

    // All other kinds (blank_line, comment_line, directive_statement,
    // preprocessor_statement, style/title blocks, declaration_statement|member,
    // plain relation_statement, etc.) are neutral — valid in any diagram type.
  }

  return hasSequenceIndicator;
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

export function detectDiagramType(dsl, parsed) {
  let directive = String(parsed?.startDirective || '').toLowerCase();
  if (!directive) {
    const lines = String(dsl || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const d = parseDirectiveLine('start', lines[i]);
      if (d && d.directive) {
        directive = String(d.directive).toLowerCase();
        break;
      }
    }
  }
  if (!directive) {
    if (looksLikeSequenceFromParsed(parsed)) return DiagramType.Sequence;
    return DiagramType.UML;
  }
  if (directive === '@startuml') {
    if (looksLikeSequenceFromParsed(parsed)) return DiagramType.Sequence;
    return DiagramType.UML;
  }
  return DiagramType.UML;
}

export function dispatch(dsl) {
  const text = String(dsl || '');
  const parsed = parsePlantUml(text);
  const diagramType = detectDiagramType(text, parsed);
  const body = stripStartEnd(text);
  return { diagramType, body, parsed };
}
