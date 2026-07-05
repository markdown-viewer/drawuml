// --------------- Unified diagram context detection ----------------------------
//
// Single-pass scan over parsed statements to determine the diagram context.
// Covers both sequence-vs-UML classification and sub-context detection
// (class/usecase/deployment/state) in one function.
//
// Sequence detection mirrors PlantUML's factory priority:
// SequenceDiagramFactory (priority 3) takes precedence over
// ClassDiagramFactory (priority 4).  A diagram is "sequence" when:
//   1. NO statement belongs to a non-sequence category
//   2. At least ONE statement is a sequence-specific indicator
//
// Sub-context priority (matches PlantUML factory order):
//   state > usecase > deployment > class (default)

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
  // ArchiMate declarations
  'declaration_statement|archimate',
  'declaration_statement|junction',
  // mxgraph icon declarations
  'generic_statement|mxgraph_icon',

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

/** Specific kind|type pairs that indicate sequence diagram. */
const SEQUENCE_INDICATOR_TYPES = new Set([
  // Participant declarations
  'declaration_statement|participant',
  'declaration_statement|mainframe',
  'declaration_statement|autoactivate',
  // Message arrows (NOTE: routing_relation handled separately below)
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

/** Component types that are neutral for sequence detection (valid as
 *  both sequence participants and non-sequence declarations). */
const SEQUENCE_NEUTRAL_COMPONENT_TYPES = new Set([
  'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue',
]);

/** Deployment-specific component keywords. */
export const DEPLOYMENT_COMPONENT_KEYWORDS = new Set([
  'node', 'cloud', 'artifact', 'agent',
  'component', 'component1', 'component2',
  'frame', 'card', 'hexagon', 'storage',
  'rectangle', 'rect', 'folder',
  'file', 'stack', 'process', 'person', 'label',
  'port', 'portin', 'portout',
]);

export type DiagramContext = 'sequence' | 'class' | 'usecase' | 'deployment' | 'state' | 'description' | 'activity';

/**
 * Detect diagram context from parsed statements in a single pass.
 *
 * Sequence detection uses exclusion logic: if ANY non-sequence-only statement
 * is found, the diagram cannot be sequence.  Sub-context detection uses
 * inclusion logic: flags are set when context-specific indicators appear.
 *
 * Priority: sequence (if eligible) > state > usecase > deployment > class
 */
export function detectDiagramContext(parsed): DiagramContext {
  const statements = Array.isArray(parsed?.statements) ? parsed.statements : [];

  // Non-@startuml directives are never sequence diagrams
  const directive = String(parsed?.startDirective || '').toLowerCase();
  let hasNonSequence = directive !== '' && directive !== '@startuml';

  let hasSequenceIndicator = false;
  let hasState = false;
  let hasUsecase = false;
  let hasDeployment = false;
  let hasExplicitClassDecl = false;
  let hasImplicitClassDecl = false;
  let hasActivity = false;
  let hasStrongActivity = false; // :text;, start, stop, if, etc. — unambiguous activity indicators
  let hasArrowStatement = false; // arrow_statement → legacy activity syntax (handled by class parser)
  let hasBareRouting = false; // bare-endpoint routing_relation without deployment-specific syntax

  for (const st of statements) {
    if (!st || typeof st !== 'object') continue;

    const kind = st.kind || '';
    const type = st.type || '';
    const key = kind + '|' + type;

    // ── Non-sequence statement kinds / types ──
    if (NON_SEQUENCE_KINDS.has(kind) || NON_SEQUENCE_TYPES.has(key)) {
      hasNonSequence = true;
    }

    // ── Sequence: autoactivate (parsed as declaration_statement|member) ──
    if (kind === 'declaration_statement' && type === 'member' &&
        /^autoactivate\b/i.test(String(st.raw || ''))) {
      hasSequenceIndicator = true;
    }

    // ── Activity diagram indicators ──
    if (kind === 'activity_statement' || kind === 'activity_text_line') {
      // 'return' is also a valid sequence message — don't mark as non-sequence
      if (kind === 'activity_statement' && type === 'return') {
        hasActivity = true;
        hasSequenceIndicator = true;
      } else if (kind === 'activity_statement' && st.paren) {
        // (text) is ambiguous: could be activity or usecase declaration.
        // Mark both and let priority logic decide based on other indicators.
        hasActivity = true;
        hasUsecase = true;
      } else {
        hasActivity = true;
        hasStrongActivity = true;
        hasNonSequence = true;
      }
    }
    if (kind === 'control_statement') {
      const t = type || String(st.text || '').toLowerCase();
      if (['if', 'elseif', 'else', 'endif', 'switch', 'case', 'endswitch',
           'fork', 'end fork', 'split', 'while', 'repeat',
           'backward', 'arrow', 'link'].includes(t)) {
        hasActivity = true;
        hasStrongActivity = true;
      }
      if (['start', 'stop', 'end', 'kill', 'detach', 'break'].includes(t)
          || ['start', 'stop', 'end', 'kill', 'detach', 'break'].includes(String(st.text || '').toLowerCase())) {
        hasActivity = true;
        hasStrongActivity = true;
      }
    }
    if (kind === 'block_statement' && type === 'swimlane') {
      hasActivity = true;
      hasStrongActivity = true;
      hasNonSequence = true;
    }
    // partition is valid in both activity and sequence diagrams (box grouping);
    // it is neutral for sequence detection — other indicators will decide.
    if (kind === 'block_statement' && type === 'partition') {
      hasActivity = true;
    }

    // ── Legacy activity diagram: arrow_statement (e.g. (*) --> "Node") ──
    if (kind === 'arrow_statement') {
      hasArrowStatement = true;
    }

    // ── Track explicit vs implicit class declarations ──
    // Explicit: `class Foo`, `interface Bar`, `enum Baz` etc.
    // Implicit: `Foo <<Bar>>` (no class keyword, parsed as class_declaration with implicit: true)
    // PlantUML's DescriptionDiagramFactory (priority 1) handles implicit declarations
    // as entity declarations (default shape: actor), while ClassDiagramFactory (priority 4)
    // handles explicit declarations as class rectangles.
    if (kind === 'class_declaration') {
      if (st.implicit) hasImplicitClassDecl = true;
      else hasExplicitClassDecl = true;
    }

    // ── Sequence-specific indicators ──
    if (kind === 'hnote' || SEQUENCE_INDICATOR_TYPES.has(key)) {
      hasSequenceIndicator = true;
    }

    // ── ArchiMate stdlib → never sequence ──
    if (kind === 'preprocessor_statement' &&
        /archimate\/Archimate/i.test(String(st.text || ''))) {
      hasNonSequence = true;
    }

    // ── Note statements ──
    if (kind === 'note_start' || kind === 'note_statement') {
      if (st.alias || st.on === 'link') hasNonSequence = true;
      if (st.over || st.across) hasSequenceIndicator = true;
    }

    // ── Component statement ──
    if (kind === 'component_statement') {
      const ct = String(st.componentType || '').toLowerCase();
      // Block body (e.g. "entity Foo {") → class/ER declaration, not sequence
      if (st.block) hasNonSequence = true;
      // Actor/usecase keywords → usecase context
      if (/^(actor|usecase)/i.test(ct)) hasUsecase = true;
      // Usecase keyword also excludes sequence
      if (ct === 'usecase' || ct === 'usecase/') {
        hasNonSequence = true;
      } else if (SEQUENCE_NEUTRAL_COMPONENT_TYPES.has(ct)) {
        // actor/boundary/control/entity/database/collections/queue are
        // neutral for sequence detection — they appear in both sequence
        // and non-sequence diagrams
      } else if (DEPLOYMENT_COMPONENT_KEYWORDS.has(ct)) {
        hasNonSequence = true;
        hasDeployment = true;
      } else if (ct) {
        hasNonSequence = true;
      }
    }

    // ── relation_statement with arrowMeta ──
    if (kind === 'relation_statement' && st.arrowMeta) {
      const sh = String(st.arrowMeta.startHeadToken || '');
      const eh = String(st.arrowMeta.endHeadToken || '');
      const heads = sh + eh;
      if (/[|*#{}+^]/.test(heads)) hasNonSequence = true;
      if (/[\\\/]/.test(heads) || /^>(x|o)$/.test(eh) || /^>>(o)$/.test(eh)) {
        hasSequenceIndicator = true;
      }
    }

    // ── usecase_relation ──
    if (key === 'generic_statement|usecase_relation') {
      const rawFrom = String(st.from || '');
      const rawTo = String(st.to || '');
      if ((rawFrom.startsWith('(') && rawFrom.endsWith(')')) ||
          (rawTo.startsWith('(') && rawTo.endsWith(')')) ||
          (rawFrom.startsWith(':') && rawFrom.endsWith(':')) ||
          (rawTo.startsWith(':') && rawTo.endsWith(':'))) {
        hasNonSequence = true;
        hasUsecase = true;
      }
    }

    // ── routing_relation ──
    if (key === 'generic_statement|routing_relation') {
      const rawFrom = String(st.from || '');
      const rawTo = String(st.to || '');
      if (rawFrom === '[*]' || rawTo === '[*]') {
        // [*] is a state diagram start/end pseudo-state
        hasNonSequence = true;
        hasState = true;
      } else if (rawFrom.startsWith('[') || rawTo.startsWith('[')) {
        // [name] is deployment component shorthand syntax
        hasNonSequence = true;
        hasDeployment = true;
      } else if ((!rawFrom.includes(',') && rawFrom.startsWith('(') && rawFrom.endsWith(')')) ||
                 (!rawTo.includes(',') && rawTo.startsWith('(') && rawTo.endsWith(')'))) {
        // (Name) without comma → use-case endpoint.
        // (A, B) with comma → n-ary association diamond (class diagram).
        hasNonSequence = true;
        hasUsecase = true;
      } else {
        const arrow = String(st.arrow || '');
        const arrowNoColor = arrow.replace(/\[#[^\]]*\]/g, '');
        if (/[|*#{}+^]/.test(arrowNoColor) || /-(?:left|right|up|down)-/i.test(arrowNoColor)) {
          hasNonSequence = true;
          hasBareRouting = true;
        } else if (/^[~.=\-]{2,}$/.test(arrowNoColor)) {
          // Symmetric double-char arrows (~~, .., ==, --) are class/deployment relations
          hasNonSequence = true;
          hasBareRouting = true;
        } else if (/[0()]/.test(arrowNoColor)) {
          // Lollipop/socket/ball arrows (0, (, )) are deployment-specific
          hasNonSequence = true;
          hasDeployment = true;
        } else {
          hasSequenceIndicator = true;
        }
      }
    }

    // ── State diagram indicators ──
    if ((kind === 'declaration_statement' && type === 'state') ||
        kind === 'state_body_line' ||
        (kind === 'block_statement' && type === 'state_block_end') ||
        (typeof st.from === 'string' && st.from === '[*]') ||
        (typeof st.to === 'string' && st.to === '[*]')) {
      hasState = true;
    }

    // ── Use-case diagram indicators ──
    if (kind === 'declaration_statement') {
      if (type === 'usecase' || type === 'usecase_actor' || type === 'usecase_alias') {
        hasUsecase = true;
      }
      if (type === 'member' && /^(actor|usecase)$/i.test(String(st.dataType || ''))) {
        hasUsecase = true;
      }
    }
    if (kind === 'generic_statement' && type === 'two_column' && /^(actor|usecase)$/i.test(String(st.left || ''))) {
      hasUsecase = true;
    }
    if (kind === 'generic_statement' && type === 'slashy_relation' && /^(actor|usecase)$/i.test(String(st.from || ''))) {
      hasUsecase = true;
    }
    // Relation endpoints with (Name) or :Name: syntax
    const from = String(st.from || '').trim();
    const to = String(st.to || '').trim();
    if (from && (/^\([^,]+\)$/.test(from) || /^:.*:$/.test(from))) hasUsecase = true;
    if (to && (/^\([^,]+\)$/.test(to) || /^:.*:$/.test(to))) hasUsecase = true;

    // ── Deployment diagram indicators ──
    // component_statement already handled above
    if (kind === 'generic_statement' && type === 'two_column') {
      const left = String(st.left || '').toLowerCase();
      if (DEPLOYMENT_COMPONENT_KEYWORDS.has(left)) hasDeployment = true;
    }
    // ── Gantt task that looks like state transition ([*] --> ...) ──
    if (kind === 'gantt_task' && /^\s*\[?\*\]?\s*-/.test(String(st.raw || ''))) {
      hasNonSequence = true;
      hasState = true;
    }

  }

  // Priority: sequence (if eligible) > state > activity > deployment > usecase > description > class
  // Deployment > usecase because PlantUML's DescriptionDiagramFactory treats
  // both as "description" diagrams. Actors/usecases can appear in deployment
  // diagrams (with :name: or (name) syntax), and deployment-specific keywords
  // (component, node, etc.) should take precedence.
  if (!hasNonSequence && hasSequenceIndicator) return 'sequence';
  if (hasState) return 'state';
  // arrow_statement is legacy activity syntax — must go through the class parser,
  // not the new activity parser which does not handle arrow_statement.
  if (hasStrongActivity && !hasArrowStatement) return 'activity';
  if (hasDeployment) return 'deployment';
  if (hasUsecase) return 'usecase';
  if (hasActivity) return 'activity';
  // Bare routing_relations (e.g. A -- B : label) without explicit class
  // declarations indicate a deployment/description diagram in PlantUML's
  // DescriptionDiagramFactory (priority 1).
  if (hasBareRouting && !hasExplicitClassDecl) return 'deployment';
  // Description: implicit-only class declarations (no explicit `class` keyword).
  // Matches PlantUML's DescriptionDiagramFactory (priority 1) which renders
  // bare entity declarations like `Foo <<Bar>>` as actors by default.
  if (hasImplicitClassDecl && !hasExplicitClassDecl) return 'description';
  return 'class';
}
