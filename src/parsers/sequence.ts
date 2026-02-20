import { NodeType } from '../model/index.ts';
import { parsePlantUml } from './puml.ts';

interface ParsedDocumentLike {
  statements?: any[];
}

interface ParseSequenceDiagramOptions {
  strict?: boolean;
  parsed?: ParsedDocumentLike | null;
}

const PARTICIPANT_KEYWORDS = {
  participant: NodeType.Participant,
  actor: NodeType.Actor,
  boundary: NodeType.Boundary,
  control: NodeType.Control,
  entity: NodeType.Entity,
  database: NodeType.Database,
  collections: NodeType.Collections,
  queue: NodeType.Queue,
};

function normalizeId(token) {
  return String(token || '').trim().replace(/\s+/g, '_');
}

function isSequenceMessageStatement(st) {
  if (!st || typeof st !== 'object') return false;
  if (st.kind !== 'generic_statement') return false;
  return [
    'routing_relation',
    'decorated_relation',
    'slashy_relation',
    'sequence_message',
    'timed_message',
    'async_message',
    'sequence_start_message',
    'sequence_end_message',
  ].includes(String(st.type || ''));
}

function notePositionFromStatement(st, strict) {
  if (st.pos === 'left' || st.dir === 'left') return 'left';
  if (st.pos === 'right' || st.dir === 'right') return 'right';
  if (st.pos === 'over' || st.dir === 'over' || st.pos == null) return 'over';
  if (strict) {
    throw new Error(`Unsupported sequence note position: ${String(st.pos || st.dir)}`);
  }
  return 'over';
}

function requireArrowToken(arrowToken) {
  const token = String(arrowToken ?? '').trim();
  if (!token) {
    throw new Error('Sequence arrow token is empty');
  }
  return token;
}

function inferSequenceDirection(token, startHeadToken, endHeadToken) {
  const hasLeftBridge = token.indexOf('<-') >= 0;
  const hasRightBridge = token.indexOf('->') >= 0;
  if (hasLeftBridge && !hasRightBridge) return 'left';
  if (hasRightBridge && !hasLeftBridge) return 'right';
  // Check for directional head tokens (including compound ones)
  // Start heads with direction: <, [, ?, \\, //
  const startHasDir = /[<\[?\\\/]/.test(startHeadToken);
  // End heads with direction: >, \, /, ], ?, x, and compound like >o, >x, etc.
  const endHasDir = /[>\\/?\]x]/.test(endHeadToken);
  if (startHasDir && !endHasDir) return 'left';
  if (endHasDir && !startHasDir) return 'right';
  if (startHasDir && endHasDir) return 'right'; // bidirectional, default to right
  if (!startHeadToken && !endHeadToken) return 'right';
  throw new Error(`Unsupported ambiguous sequence arrow token: ${token}`);
}

function resolveSequenceArrowStyle(arrowToken, arrowMeta) {
  const token = requireArrowToken(arrowToken);
  const meta = arrowMeta && typeof arrowMeta === 'object' ? arrowMeta : null;
  if (!meta) {
    throw new Error(`Missing structured sequence arrow metadata for token: ${token}`);
  }

  const metaToken = String(meta.token || '').trim();
  if (metaToken && metaToken !== token) {
    throw new Error(`Mismatched sequence arrow metadata token: ${metaToken} vs ${token}`);
  }

  const startHeadToken = String(meta.startHeadToken || meta.startHead || '').trim();
  const endHeadToken = String(meta.endHeadToken || meta.endHead || '').trim();
  const bodyToken = String(meta.bodyToken || '').trim();

  // Strip boundary/short markers ([, ], ?) from head tokens for arrow classification.
  // These are positional markers, not directional arrow features.
  const innerStartHead = startHeadToken.replace(/^[\[?]/, '');
  const innerEndHead = endHeadToken.replace(/[\]?]$/, '');

  // In sequence diagrams, '--' body means dashed line
  const lineStyle = (String(meta.lineStyle || 'solid') === 'dashed' || /--/.test(bodyToken))
    ? 'dashed' : 'solid';

  const direction = inferSequenceDirection(token, startHeadToken, endHeadToken);
  // PEG no longer flips half-arrow end tokens — tokens represent visual shape directly.
  const visibleHeadToken = direction === 'left'
    ? (innerStartHead || innerEndHead)
    : (innerEndHead || innerStartHead);

  let arrowHead = 'filled';
  // Strip leading/trailing decorators (o, x) from head for classification
  const cleanHead = visibleHeadToken.replace(/o$/, '').replace(/x$/, '').replace(/^o/, '').replace(/^x/, '');
  if (cleanHead === '<<' || cleanHead === '>>' || cleanHead === '<' || cleanHead === '>') {
    // Check if original has >> or << (open/thin arrowhead)
    if (visibleHeadToken.startsWith('>>') || visibleHeadToken.startsWith('<<')) arrowHead = 'open';
    else arrowHead = 'filled';
  } else if (cleanHead === '\\' || cleanHead === '\\\\') arrowHead = 'half_bottom';
  else if (cleanHead === '/' || cleanHead === '//') arrowHead = 'half_top';
  else if (visibleHeadToken === 'x' || visibleHeadToken === '>x') arrowHead = 'cross';
  else if (visibleHeadToken === 'o' || visibleHeadToken === '>o' || visibleHeadToken === '>>o') arrowHead = 'filled';
  else if (visibleHeadToken === '' && bodyToken) arrowHead = 'filled';
  // Determine start/end decorators (using inner heads without bracket/question markers)
  const startDecorator = /^[xo]/.test(innerStartHead) && innerStartHead.length >= 1
    ? (innerStartHead[0] === 'x' ? 'cross' : innerStartHead[0] === 'o' ? 'circle' : 'none') : 'none';
  const endDecoratorMatch = visibleHeadToken.match(/([xo])$/);
  const endDecorator = endDecoratorMatch
    ? (endDecoratorMatch[1] === 'x' ? 'cross' : 'circle') : 'none';

  // Detect bidirectional arrows (<-> <->> o<->o etc.)
  // Use inner heads to avoid false positives from ] or ? markers.
  // The '<' may follow a decorator char (o, x), so check anywhere in the token.
  const bidirectional = /</.test(innerStartHead) && innerEndHead.length > 0;

  return { token, startHeadToken, endHeadToken, bodyToken, direction, lineStyle, arrowHead, bidirectional, startDecorator, endDecorator, color: meta.color || undefined };
}

function parseInlineSequenceStatement(text, strict) {
  const line = (text || '').trim();
  if (!line) return null;
  const parsed = parsePlantUml(`@startuml\n${line}\n@enduml`);
  const statements = Array.isArray(parsed?.statements) ? parsed.statements : [];
  for (const st of statements) {
    if (!st || typeof st !== 'object') continue;
    if (isSequenceMessageStatement(st)) {
      try {
        const arrow = requireArrowToken(st.arrow);
        const arrowMeta = st.arrowMeta || null;
        if (st.type === 'sequence_start_message') {
          return { from: '__external_left__', to: st.target, label: st.label || '', arrow, arrowMeta };
        }
        if (st.type === 'sequence_end_message') {
          return { from: st.from, to: '__external_right__', label: st.label || '', arrow, arrowMeta };
        }
        const label = st.type === 'sequence_message'
          ? (st.text || '')
          : (st.label || st.text || '');
        return { from: st.from, to: st.to, label, arrow, arrowMeta };
      } catch (error) {
        if (strict) throw error;
        continue;
      }
    }
    if (st.kind === 'relation_statement') {
      try {
        const arrow = requireArrowToken(st.arrow);
        const arrowMeta = st.arrowMeta || null;
        return { from: st.from, to: st.to, label: st.label || '', arrow, arrowMeta };
      } catch (error) {
        if (strict) throw error;
      }
    }
  }
  return null;
}

export function parseSequenceDiagram(body, options: ParseSequenceDiagramOptions = {}) {
  const strict = options.strict !== false;
  const parsed = options.parsed && Array.isArray(options.parsed.statements)
    ? options.parsed
    : parsePlantUml(String(body || ''));

  const statements = Array.isArray(parsed?.statements) ? parsed.statements : [];

  const participantMap = new Map();
  const participantOrder = [];
  const participantRefs = new Map();

  const messages = [];
  const notes = [];
  const fragments = [];
  const dividers = [];
  const activations = [];
  const boxes = [];
  let hideFootbox = false;
  let responseMessageBelowArrow = false;
  let guillemet = true;
  let stereotypePosition: 'top' | 'bottom' = 'top';
  let participantAlign: 'left' | 'center' | 'right' = 'center';
  const titleLines: string[] = [];
  let mainframeLabel: string | undefined;
  let currentBox: { label: string; color?: string; participants: string[] } | null = null;

  const fragmentStack = [];
  const activationStack = new Map();

  // Autonumber state
  let autonumberActive = false;
  let autonumberCounter: number[] = [1]; // supports hierarchical like [1,1,1]
  let autonumberIncrement = 1;
  let autonumberFormat = '';  // empty = plain number
  let autonumberSaved: { counter: number[]; increment: number; format: string } | null = null;
  let lastFormattedAutonumber = ''; // last used autonumber value for %autonumber% substitution

  // Autoactivate state: every message auto-activates target, return deactivates and sends reply
  let autoactivateOn = false;
  const autoactivateStack: { caller: string; target: string }[] = [];

  // Track the last external caller for each participant (for manual return)
  // Updated when a non-self-ref message is sent to a participant
  const lastCallerMap = new Map<string, string>();

  // Inline activation stack: tracks ++ decor activations for LIFO return matching
  const inlineActivateStack: { caller: string; target: string }[] = [];

  // Participants pending creation via 'create' statement (will set createdAtRow on next message)
  const pendingCreate = new Set<string>();

  // Teoz tagged span: {tag} marks a row for duration constraints
  const tagRowMap = new Map<string, { row: number; fromParticipant: string; toParticipant: string }>();
  const durationConstraints = [];

  /**
   * Format the autonumber counter according to the format string.
   * Supported placeholder patterns:
   *   - 0, 00, 000... → zero-padded number
   *   - #, ##, ###... → plain number (no padding)
   * If no format, returns the counter value as a plain string.
   * For hierarchical counters, the counter is always dot-joined.
   */
  function formatAutonumber(): string {
    const numStr = autonumberCounter.length > 1
      ? autonumberCounter.join('.')
      : String(autonumberCounter[0]);

    if (!autonumberFormat) return numStr;

    // Keep HTML tags intact — drawio supports html=1 for rich text rendering
    let fmt = autonumberFormat;
    // Replace 0+ placeholder with zero-padded number
    fmt = fmt.replace(/0+/, (match) => {
      const n = autonumberCounter[autonumberCounter.length - 1];
      return String(n).padStart(match.length, '0');
    });
    // Replace #+ placeholder with plain number
    fmt = fmt.replace(/#+/, () => {
      return String(autonumberCounter[autonumberCounter.length - 1]);
    });
    return fmt.trim();
  }

  /**
   * Parse autonumber directive text and update state.
   * Variants:
   *   autonumber                        → start at 1, increment 1
   *   autonumber <start>                → start at <start>
   *   autonumber <start> <increment>    → start at <start>, increment <increment>
   *   autonumber "<format>"             → start at 1 with format
   *   autonumber <start> "<format>"     → start at <start> with format
   *   autonumber <start> <inc> "<fmt>"  → start, increment, format
   *   autonumber stop                   → stop numbering
   *   autonumber resume                 → resume from last
   *   autonumber resume "<fmt>"         → resume with new format
   *   autonumber resume <inc> "<fmt>"   → resume with new increment and format
   *   autonumber 1.1.1                  → hierarchical start
   *   autonumber inc A|B|C              → increment hierarchical level
   */
  function handleAutonumber(bodyText: string) {
    const body = bodyText.trim();

    if (body === 'stop') {
      // Save current state and deactivate
      autonumberSaved = {
        counter: [...autonumberCounter],
        increment: autonumberIncrement,
        format: autonumberFormat,
      };
      autonumberActive = false;
      return;
    }

    if (body.startsWith('resume')) {
      const rest = body.slice(6).trim();
      autonumberActive = true;
      // Restore saved state
      if (autonumberSaved) {
        autonumberCounter = [...autonumberSaved.counter];
        autonumberIncrement = autonumberSaved.increment;
        autonumberFormat = autonumberSaved.format;
      }
      if (rest) {
        // Parse optional increment and/or format
        const resumeMatch = rest.match(/^(\d+)?\s*(".*")?$/);
        if (resumeMatch) {
          if (resumeMatch[1]) autonumberIncrement = parseInt(resumeMatch[1], 10);
          if (resumeMatch[2]) autonumberFormat = resumeMatch[2].slice(1, -1);
        }
      }
      return;
    }

    if (/^inc\s+/i.test(body)) {
      // Hierarchical increment: "inc A" → level 0, "inc B" → level 1, etc.
      const levelChar = body.slice(4).trim().toUpperCase();
      const level = levelChar.charCodeAt(0) - 'A'.charCodeAt(0);
      if (level >= 0 && level < autonumberCounter.length) {
        autonumberCounter[level]++;
        // Reset all levels below
        for (let i = level + 1; i < autonumberCounter.length; i++) {
          autonumberCounter[i] = 1;
        }
      }
      return;
    }

    // Normal autonumber: parse [start] [increment] ["format"]
    autonumberActive = true;

    // Extract format string (quoted)
    let format = '';
    let rest = body;
    const fmtMatch = body.match(/"((?:[^"\\]|\\.)*)"\s*$/);
    if (fmtMatch) {
      format = fmtMatch[1];
      rest = body.slice(0, body.indexOf('"')).trim();
    }

    // Check for hierarchical start (e.g., "1.1.1")
    if (/^\d+\.\d+/.test(rest)) {
      autonumberCounter = rest.split('.').map(n => parseInt(n, 10) || 1);
      autonumberIncrement = 1;
      autonumberFormat = format;
      return;
    }

    // Parse numeric args
    const nums = rest.split(/\s+/).filter(s => /^\d+$/.test(s)).map(Number);
    if (nums.length >= 2) {
      autonumberCounter = [nums[0]];
      autonumberIncrement = nums[1];
    } else if (nums.length === 1) {
      autonumberCounter = [nums[0]];
    } else if (!body) {
      autonumberCounter = [1];
      autonumberIncrement = 1;
    }
    autonumberFormat = format;
  }

  /**
   * Advance autonumber counter after generating a label.
   */
  function advanceAutonumber() {
    if (autonumberCounter.length > 1) {
      // Hierarchical: increment last level
      autonumberCounter[autonumberCounter.length - 1] += autonumberIncrement;
    } else {
      autonumberCounter[0] += autonumberIncrement;
    }
  }

  let row = 0;
  let lastPushType = ''; // 'message' or 'note' — tracks what was last pushed
  let noteBlock = null;
  let refBlock = null;

  const FRAGMENT_KEYWORDS = ['alt', 'loop', 'opt', 'par', 'break', 'group', 'critical', 'ref', 'partition'];

  // Shared handler for fragment start/else/end keywords.
  // Returns true if the keyword was handled (caller should continue).
  function handleFragment(keyword: string, label: string, lineColor?: string, fillColor?: string): boolean {
    if (FRAGMENT_KEYWORDS.includes(keyword)) {
      fragmentStack.push({
        type: keyword, label, startRow: row, sections: [],
        lineColor, fillColor,
      });
      row++; // tab occupies a placeholder row
      return true;
    }
    if (keyword === 'else' && fragmentStack.length > 0) {
      const top = fragmentStack[fragmentStack.length - 1];
      if (!top.sections) top.sections = [];
      top.sections.push({ label, startRow: row, fillColor });
      row++; // separator line occupies a placeholder row
      return true;
    }
    if (keyword === 'end' && fragmentStack.length > 0) {
      const top = fragmentStack.pop();
      top.endRow = Math.max(top.startRow + 3, row + 1);  // exclusive: one past the end placeholder row
      fragments.push(top);
      row++; // bottom border occupies a placeholder row
      return true;
    }
    return false;
  }

  function addParticipantRef(name, id) {
    const key = normalizeId(name);
    if (!key || !id) return;
    if (!participantRefs.has(key)) participantRefs.set(key, id);
  }

  function registerParticipantRefs(participant) {
    if (!participant || !participant.id) return;
    addParticipantRef(participant.id, participant.id);
    addParticipantRef(participant.label, participant.id);
    if (participant.alias) addParticipantRef(participant.alias, participant.id);
  }

  function resolveParticipant(token) {
    const key = normalizeId(token);
    return participantRefs.get(key) || key;
  }

  /**
   * Parse stereotype strings from PEG parser output.
   * Returns { stereotypeLabel, spot } where:
   * - stereotypeLabel: display text wrapped in «» or << >> depending on guillemet setting
   * - spot: { char, color } for custom spot circles (e.g. "(C,#ADD1B2)")
   */
  function parseStereotypes(stereotypes: any[]): { stereotypeLabel: string; spot?: { char: string; color: string } } {
    if (!stereotypes || stereotypes.length === 0) return { stereotypeLabel: '' };
    // Use the first stereotype (PlantUML sequence diagrams typically have one).
    // PEG may return a plain string or a structured { text, spot } object.
    const first = stereotypes[0];
    let raw: string;
    let pegSpot: { char: string; color: string } | undefined;
    if (typeof first === 'object' && first !== null) {
      raw = String(first.text || '').trim();
      pegSpot = first.spot || undefined;
    } else {
      raw = String(first || '').trim();
    }

    // If PEG already extracted the spot, use it directly.
    if (pegSpot) {
      const displayLabel = raw
        ? (guillemet ? `«${raw}»` : `<< ${raw} >>`)
        : '';
      return { stereotypeLabel: displayLabel, spot: pegSpot };
    }
    // Check for spot pattern: (X,#COLOR) OptionalLabel
    const spotMatch = raw.match(/^\((\w),\s*(#[0-9a-fA-F]{3,8})\)\s*(.*)/);
    if (spotMatch) {
      const char = spotMatch[1];
      const color = spotMatch[2];
      const label = spotMatch[3].trim();
      const displayLabel = label
        ? (guillemet ? `«${label}»` : `<< ${label} >>`)
        : '';
      return { stereotypeLabel: displayLabel, spot: { char, color } };
    }
    // Plain stereotype text
    const displayLabel = guillemet ? `«${raw}»` : `<< ${raw} >>`;
    return { stereotypeLabel: displayLabel };
  }

  function ensureParticipant(id, label, type) {
    if (!id) return;
    if (participantMap.has(id)) return;
    const participant = {
      id,
      type: type || NodeType.Participant,
      label: label || id,
    };
    participantMap.set(id, participant);
    participantOrder.push(id);
    registerParticipantRefs(participant);
    // Track participants inside current box
    if (currentBox) currentBox.participants.push(id);
  }

  function pushMessage(fromToken, toToken, label, arrowToken, arrowMeta = null, options?: { decor?: string; color?: string; skipAutoactivate?: boolean; delay?: number; concurrent?: boolean }) {
    const normalizedFromToken = fromToken;
    let normalizedToToken = toToken;

    // Extract activation color from target (e.g., "bob #005500" → name="bob", color="#005500")
    let activationColor: string | undefined = options?.color || undefined;
    if (!activationColor) {
      const colorMatch = normalizedToToken.match(/^(.+?)\s+(#[0-9a-fA-F]{3,8})$/);
      if (colorMatch) {
        normalizedToToken = colorMatch[1];
        activationColor = colorMatch[2];
      }
    }

    let arrowStyle;
    try {
      arrowStyle = resolveSequenceArrowStyle(arrowToken, arrowMeta);
    } catch (error) {
      if (strict) {
        throw new Error(`Unsupported sequence statement: ${normalizedFromToken} ${arrowToken} ${normalizedToToken}`);
      }
      return;
    }
    // Discover participants in syntax order (determines left-to-right layout position)
    // before swapping from/to based on arrow direction.
    const isExternalId = (id: string) => id === '__external_left__' || id === '__external_right__';
    const syntaxFromId = resolveParticipant(normalizedFromToken);
    const syntaxToId = resolveParticipant(normalizedToToken);
    if (!isExternalId(syntaxFromId)) ensureParticipant(syntaxFromId, normalizedFromToken, NodeType.Participant);
    if (!isExternalId(syntaxToId)) ensureParticipant(syntaxToId, normalizedToToken, NodeType.Participant);

    const realFrom = arrowStyle.direction === 'left' ? normalizedToToken : normalizedFromToken;
    const realTo = arrowStyle.direction === 'left' ? normalizedFromToken : normalizedToToken;

    const fromId = resolveParticipant(realFrom);
    const toId = resolveParticipant(realTo);

    // Generate autonumber prefix if active
    let numberPrefix: string | undefined;
    if (autonumberActive) {
      numberPrefix = formatAutonumber();
      lastFormattedAutonumber = numberPrefix;
      // Normalize prefix HTML (close unclosed tags, quote attributes)
      // so downstream consumers don't need getClosingTags workaround
      numberPrefix = numberPrefix;
      advanceAutonumber();
    }

    // Replace %autonumber% in raw label
    let rawLabel = String(label ?? '');
    if (lastFormattedAutonumber) {
      rawLabel = rawLabel.replace(/%autonumber%/g, lastFormattedAutonumber);
    }

    // Concurrent messages (& prefix) share the same row as the previous message
    const msgRow = options?.concurrent ? Math.max(0, row - 1) : row;

    messages.push({
      from: fromId,
      to: toId,
      label: rawLabel,
      numberPrefix,
      arrowStyle,
      row: msgRow,
      decor: options?.decor || undefined,
      delay: options?.delay || 0,
    });

    // Track create/destroy lifecycle on participant
    if (options?.decor === '**' && !isExternalId(toId)) {
      const p = participantMap.get(toId);
      if (p) p.createdAtRow = msgRow;
    }
    if (options?.decor === '!!' && !isExternalId(toId)) {
      const p = participantMap.get(toId);
      if (p) p.destroyedAtRow = msgRow;
    }
    // Pending create from 'create' statement: set createdAtRow on first message to this participant
    if (pendingCreate.has(toId)) {
      const p = participantMap.get(toId);
      if (p) p.createdAtRow = msgRow;
      pendingCreate.delete(toId);
    }

    if (!options?.concurrent) {
      row += 1;
    }
    lastPushType = 'message';

    // Track last external caller for each participant (for manual return)
    if (fromId !== toId && !isExternalId(fromId) && !isExternalId(toId)) {
      lastCallerMap.set(toId, fromId);
    }

    // Inline decor activation: ++ activates target, -- deactivates source (sender), --++ deactivates source then activates target
    const decor = options?.decor;
    if (decor && !options?.skipAutoactivate && !isExternalId(toId)) {
      // -- or --++ : deactivate source (sender) first
      if (decor === '--' || decor === '--++') {
        const deactId = fromId;
        const stack = activationStack.get(deactId) || [];
        const top = stack.pop();
        if (top) {
          activations.push({
            participant: deactId,
            startRow: top.startRow,
            endRow: Math.max(top.startRow + 1, msgRow + 1),
            color: top.color,
          });
        }
        activationStack.set(deactId, stack);
      }
      // ++ or --++ : activate target
      if (decor === '++' || decor === '--++') {
        const stack = activationStack.get(toId) || [];
        stack.push({ startRow: msgRow, color: activationColor });
        activationStack.set(toId, stack);
        // Track caller for return matching (LIFO)
        inlineActivateStack.push({ caller: fromId, target: toId });
      }
    }

    // Autoactivate: activate target and push to return stack
    // Skip for create (**) and destroy (!!) decorations — they don't trigger autoactivation
    if (autoactivateOn && !options?.skipAutoactivate && !isExternalId(toId) && !isExternalId(fromId) && decor !== '!!' && decor !== '**' && decor !== '++' && decor !== '--' && decor !== '--++') {
      const stack = activationStack.get(toId) || [];
      stack.push({ startRow: msgRow, color: activationColor });
      activationStack.set(toId, stack);
      autoactivateStack.push({ caller: fromId, target: toId });
    }
  }

  // Return arrow meta for autoactivate return messages (dashed line)
  const returnArrowMeta = {
    token: '-->',
    startHead: '',
    endHead: '>',
    startHeadToken: '',
    endHeadToken: '>',
    bodyToken: '--',
    lineStyle: 'dashed',
    color: null,
    structured: true,
  };

  function handleAutoactivateReturn(label: string) {
    const entry = autoactivateStack.pop()!;
    // Generate return message FIRST (while activation is still in stack so endpoints resolve correctly)
    pushMessage(entry.target, entry.caller, label, '-->', returnArrowMeta, { skipAutoactivate: true });
    // Then close activation on target
    const stack = activationStack.get(entry.target) || [];
    const top = stack.pop();
    if (top) {
      activations.push({
        participant: entry.target,
        startRow: top.startRow,
        endRow: Math.max(top.startRow + 1, row),
        color: top.color,
      });
    }
    activationStack.set(entry.target, stack);
  }

  // Handle return for inline ++ activation or manual activate/deactivate mode
  function handleInlineReturn(label: string) {
    // Prefer inlineActivateStack (LIFO from ++ decor)
    if (inlineActivateStack.length > 0) {
      const entry = inlineActivateStack.pop()!;
      pushMessage(entry.target, entry.caller, label, '-->', returnArrowMeta, { skipAutoactivate: true });
      const stack = activationStack.get(entry.target) || [];
      const top = stack.pop();
      if (top) {
        activations.push({
          participant: entry.target,
          startRow: top.startRow,
          endRow: Math.max(top.startRow + 1, row),
          color: top.color,
        });
      }
      activationStack.set(entry.target, stack);
      return;
    }
    // Fallback: find participant with open activation via lastCallerMap
    let targetId: string | null = null;
    let callerId: string | null = null;
    for (const [pid, aStack] of activationStack.entries()) {
      if (aStack.length > 0) {
        const caller = lastCallerMap.get(pid);
        if (caller) {
          targetId = pid;
          callerId = caller;
        }
      }
    }
    if (targetId && callerId) {
      pushMessage(targetId, callerId, label, '-->', returnArrowMeta, { skipAutoactivate: true });
      const stack = activationStack.get(targetId) || [];
      const top = stack.pop();
      if (top) {
        activations.push({
          participant: targetId,
          startRow: top.startRow,
          endRow: Math.max(top.startRow + 1, row),
          color: top.color,
        });
      }
      activationStack.set(targetId, stack);
    }
  }

  function pushNote(position, participants, text, noteType?, color?, across?, concurrent?, attachedToMsg?) {
    // Replace %autonumber% in raw text
    let rawText = String(text ?? '');
    if (lastFormattedAutonumber) {
      rawText = rawText.replace(/%autonumber%/g, lastFormattedAutonumber);
    }
    const noteText = rawText.trim();
    // Auto-register participants referenced by notes (preserves first-appearance ordering)
    const resolvedParticipants = (participants || []).map((p) => {
      const id = resolveParticipant(p);
      ensureParticipant(id, p, NodeType.Participant);
      return id;
    }).filter(Boolean);
    // 'note left/right' (without 'of') after a message: share the message's row (displayed alongside the arrow).
    // 'note left/right of X' with explicit participant: independent row below.
    // note over / hnote / rnote after a message: independent row below (displayed as separate unit).
    // '/' prefix (concurrent) or '&' prefix: share the same row as the previous item.
    const shareRow = (attachedToMsg && lastPushType === 'message') || (concurrent && (lastPushType === 'note' || lastPushType === 'message'));
    const noteRow = shareRow ? row - 1 : row;
    notes.push({
      text: noteText,
      position,
      participants: resolvedParticipants,
      row: noteRow,
      noteType: noteType || 'note',
      color: color || null,
      across: !!across,
    });
    if (!shareRow) {
      row += 1;
    }
    lastPushType = 'note';
  }

  for (const st of statements) {
    if (!st || typeof st !== 'object') continue;

    if (noteBlock) {
      if (st.kind === 'note_end' || (st.kind === 'block_statement' && (st.type === 'rnote_end' || st.type === 'hnote_end'))) {
        pushNote(noteBlock.position, noteBlock.participants, noteBlock.lines.join('\n'), noteBlock.noteType, noteBlock.color, false, noteBlock.concurrent, noteBlock.attachedToMsg);
        noteBlock = null;
        continue;
      }
      if (st.kind === 'note_text_line') {
        noteBlock.lines.push(st.text || st.raw || '');
        continue;
      }
    }

    if (refBlock) {
      if ((st.kind === 'block_statement' && st.type === 'ref_end')
        || (st.kind === 'ref_text_line' && String(st.text || '').trim().toLowerCase() === 'end ref')) {
        refBlock.endRow = Math.max(refBlock.startRow + 1, row);
        fragments.push(refBlock);
        refBlock = null;
        continue;
      }
      if (st.kind === 'ref_text_line') {
        // Capture text lines into ref block label
        const line = (st.text || '').trim();
        if (line) {
          refBlock.label = refBlock.label ? refBlock.label + '\n' + line : line;
        }
        continue;
      }
    }

    if (st.kind === 'markup_statement' && st.type === 'style_rule') {
      // Extract HorizontalAlignment from <style> participant {...} blocks
      const ruleName = String(st.name || '').toLowerCase();
      if (ruleName === 'participant' || ruleName === 'actor' || ruleName === 'boundary' ||
          ruleName === 'control' || ruleName === 'entity' || ruleName === 'queue' ||
          ruleName === 'database' || ruleName === 'collections') {
        const bodyStr = String(st.body || '');
        const alignMatch = bodyStr.match(/HorizontalAlignment\s+(left|center|right)/i);
        if (alignMatch) participantAlign = alignMatch[1].toLowerCase() as 'left' | 'center' | 'right';
      }
    }

    if (st.kind === 'blank_line' || st.kind === 'comment_line' || st.kind === 'markup_statement') {
      continue;
    }

    if (st.kind === 'component_text_line') {
      continue;
    }

    if (st.kind === 'style_text_line') {
      continue;
    }

    if (st.kind === 'title_text_line') {
      // Collect title content lines (between title/end title block)
      titleLines.push(st.text || st.raw || '');
      continue;
    }

    if (st.kind === 'generic_statement' && st.type === 'nested_directive') {
      continue;
    }

    if (st.kind === 'directive_statement') {
      const kw = String(st.keyword || '').toLowerCase();
      const txt = String(st.text || '').trim();
      const txtLower = txt.toLowerCase();
      if (kw === 'hide' && txtLower === 'footbox') {
        hideFootbox = true;
      }
      if (kw === 'skinparam' && /responsemessagebelowarrow\s+true/i.test(txt)) {
        responseMessageBelowArrow = true;
      }
      if (kw === 'skinparam' && /guillemet\s+false/i.test(txt)) {
        guillemet = false;
      }
      if (kw === 'skinparam' && /stereotypeposition\s+bottom/i.test(txt)) {
        stereotypePosition = 'bottom';
      }
      if (kw === 'autonumber') {
        handleAutonumber(txt);
      }
      if (kw === 'newpage') {
        // Only render the first page; stop processing further statements
        break;
      }
      if (kw === 'title') {
        titleLines.push(txt);
      }
      continue;
    }

    if (st.kind === 'declaration_statement' && st.type === 'participant') {
      const label = st.label || st.text || st.alias || '';
      const alias = st.alias ? normalizeId(st.alias) : undefined;
      const id = normalizeId(alias || label);
      const color = st.style || undefined;
      const stereo = parseStereotypes(st.stereotypes || []);
      const participant: any = {
        id,
        type: NodeType.Participant,
        label,
        alias,
        color,
        order: st.order,
      };
      if (stereo.stereotypeLabel) participant.stereotypeLabel = stereo.stereotypeLabel;
      if (stereo.spot) participant.spot = stereo.spot;
      if (!participantMap.has(id)) {
        participantOrder.push(id);
        if (currentBox) currentBox.participants.push(id);
      }
      participantMap.set(id, participant);
      registerParticipantRefs(participant);
      continue;
    }

    if (st.kind === 'block_statement' && st.type === 'component_bracket_start' && String(st.componentType || '').toLowerCase() === 'participant') {
      const lines: string[] = st.lines && st.lines.length ? st.lines : [];
      const label = lines.length ? lines.join('\n') : (st.name || 'participant');
      const id = normalizeId(st.name || label);
      const participant: any = { id, type: NodeType.Participant, label };
      if (lines.length) participant.bracketLines = lines;
      if (!participantMap.has(id)) {
        participantOrder.push(id);
        if (currentBox) currentBox.participants.push(id);
      }
      participantMap.set(id, participant);
      registerParticipantRefs(participant);
      continue;
    }

    if (st.kind === 'block_statement' && st.type === 'component_bracket_end') {
      continue;
    }

    if (st.kind === 'component_statement') {
      const type = String(st.componentType || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(PARTICIPANT_KEYWORDS, type)) {
        const label = st.name || st.alias || type;
        const id = normalizeId(st.alias || label);
        const color = st.style || undefined;
        const stereo = parseStereotypes(st.stereotypes || []);
        const participant: any = { id, type: PARTICIPANT_KEYWORDS[type], label, alias: st.alias || undefined, color, order: st.order };
        if (stereo.stereotypeLabel) participant.stereotypeLabel = stereo.stereotypeLabel;
        if (stereo.spot) participant.spot = stereo.spot;
        if (!participantMap.has(id)) {
          participantOrder.push(id);
          if (currentBox) currentBox.participants.push(id);
        }
        participantMap.set(id, participant);
        registerParticipantRefs(participant);
        continue;
      }
    }

    if (st.kind === 'declaration_statement' && st.type === 'member') {
      const dt = String(st.dataType || '').toLowerCase();
      if (Object.prototype.hasOwnProperty.call(PARTICIPANT_KEYWORDS, dt)) {
        const label = st.name || st.text || dt;
        const id = normalizeId(label);
        const participant = { id, type: PARTICIPANT_KEYWORDS[dt], label };
        if (!participantMap.has(id)) {
          participantOrder.push(id);
          if (currentBox) currentBox.participants.push(id);
        }
        participantMap.set(id, participant);
        registerParticipantRefs(participant);
        continue;
      }
      if (dt === 'activate' || dt === 'deactivate' || dt === 'destroy') {
        const who = st.name || st.text || '';
        if (who) {
          const id = resolveParticipant(who);
          ensureParticipant(id, who, NodeType.Participant);
          if (dt === 'activate') {
            const stack = activationStack.get(id) || [];
            stack.push({ startRow: Math.max(0, row - 1), color: undefined });
            activationStack.set(id, stack);
          } else {
            const stack = activationStack.get(id) || [];
            const top = stack.pop();
            if (top) {
              activations.push({
                participant: id,
                startRow: top.startRow,
                endRow: Math.max(top.startRow + 1, row),
                color: top.color,
                destroyed: dt === 'destroy',
              });
            }
            activationStack.set(id, stack);
          }
        }
        continue;
      }
      if (handleFragment(dt, st.name || st.text || '')) {
        continue;
      }
      if (dt === 'autoactivate') {
        autoactivateOn = (st.name || '').toLowerCase() === 'on';
        continue;
      }
      if (dt === 'return') {
        if (autoactivateOn && autoactivateStack.length > 0) {
          handleAutoactivateReturn(st.name || '');
        } else {
          handleInlineReturn(st.name || '');
        }
        continue;
      }
      if (dt === 'create' || dt === 'end' || dt === 'box') {
        continue;
      }

      if (st.tag) {
        const normalizedText = (st.text || '').trim();
        const parsedMessage = parseInlineSequenceStatement(normalizedText, strict);
        if (parsedMessage) {
          // Record tag → row mapping for duration constraints
          const fromId = resolveParticipant(parsedMessage.from);
          const toId = resolveParticipant(parsedMessage.to);
          tagRowMap.set(st.tag, { row, fromParticipant: fromId, toParticipant: toId });
          pushMessage(parsedMessage.from, parsedMessage.to, parsedMessage.label, parsedMessage.arrow, parsedMessage.arrowMeta || null);
          continue;
        }
      }

    }

    if (st.kind === 'declaration_statement' && st.type === 'mainframe') {
      mainframeLabel = st.text || '';
      continue;
    }

    if (st.kind === 'control_statement') {
      if (st.type === 'activate') {
        const who = st.who;
        const id = resolveParticipant(who);
        ensureParticipant(id, who, NodeType.Participant);
        const stack = activationStack.get(id) || [];
        stack.push({ startRow: Math.max(0, row - 1), color: st.color || undefined });
        activationStack.set(id, stack);
        continue;
      }
      if (st.type === 'deactivate' || st.type === 'destroy') {
        const who = st.who;
        const id = resolveParticipant(who);
        ensureParticipant(id, who, NodeType.Participant);
        const stack = activationStack.get(id) || [];
        const top = stack.pop();
        if (top) {
          activations.push({
            participant: id,
            startRow: top.startRow,
            endRow: Math.max(top.startRow + 1, row),
            color: top.color,
            destroyed: st.type === 'destroy',
          });
        }
        activationStack.set(id, stack);
        continue;
      }
      if (st.type === 'create') {
        // 'create [type] Name' - grammar provides structured name and optional participantType
        const name = st.name || '';
        if (name) {
          const ptKey = (st.participantType || '').toLowerCase();
          const participantType = Object.prototype.hasOwnProperty.call(PARTICIPANT_KEYWORDS, ptKey)
            ? PARTICIPANT_KEYWORDS[ptKey]
            : NodeType.Participant;
          const id = resolveParticipant(name);
          ensureParticipant(id, name, participantType);
          // Update type if participant was already registered as default
          const p = participantMap.get(id);
          if (p && participantType !== NodeType.Participant) {
            p.type = participantType;
          }
          pendingCreate.add(id);
        }
        continue;
      }
    }

    if (st.kind === 'activity_statement' && st.type === 'return') {
      if (autoactivateOn && autoactivateStack.length > 0) {
        handleAutoactivateReturn(st.text || '');
      } else {
        handleInlineReturn(st.text || '');
      }
      continue;
    }

    if (st.kind === 'block_statement' && st.type === 'section') {
      dividers.push({ label: st.text || '', row });
      row += 1;
      continue;
    }

    if (st.kind === 'block_statement' && st.type === 'box_start') {
      currentBox = { label: st.label || '', color: st.color || undefined, participants: [] };
      continue;
    }
    if (st.kind === 'block_statement' && st.type === 'box_end') {
      if (currentBox) {
        boxes.push(currentBox);
        currentBox = null;
      }
      continue;
    }

    if (st.kind === 'block_statement' && (st.type === 'title_start' || st.type === 'title_end' || st.type === 'style_block_end')) {
      continue;
    }

    if (st.kind === 'block_statement' && st.type === 'table_row') {
      const raw = st.raw || '';
      // ||| or ||N|| are vertical spacers — treat as invisible like ellipsis
      if (/^\|\|\|$/.test(raw.trim()) || /^\|\|\d+\|\|$/.test(raw.trim())) {
        dividers.push({ label: raw, row, type: 'ellipsis' });
      } else {
        dividers.push({ label: raw, row });
      }
      row += 1;
      continue;
    }

    if (st.kind === 'generic_statement' && (st.type === 'delay' || st.type === 'ellipsis')) {
      dividers.push({ label: st.text || '...', row, type: st.type });
      row += 1;
      continue;
    }

    if (st.kind === 'generic_statement' && st.type === 'sequence_tagged_span') {
      const fromEntry = tagRowMap.get(st.fromTag);
      const toEntry = tagRowMap.get(st.toTag);
      if (fromEntry && toEntry) {
        // Collect unique participants involved in both tagged messages
        const pSet = new Set([fromEntry.fromParticipant, fromEntry.toParticipant, toEntry.fromParticipant, toEntry.toParticipant]);
        const participantsList = [...pSet].filter(p => p && p !== '__external_left__' && p !== '__external_right__');
        durationConstraints.push({
          label: st.label || '',
          fromTag: st.fromTag,
          toTag: st.toTag,
          startRow: Math.min(fromEntry.row, toEntry.row),
          endRow: Math.max(fromEntry.row, toEntry.row),
          participants: participantsList,
        });
      }
      // Duration constraints don't occupy a row
      continue;
    }

    if (st.kind === 'block_statement' && st.type === 'sequence_block') {
      const keyword = String(st.keyword || '').toLowerCase();
      if (handleFragment(keyword, st.text || '', st.lineColor, st.fillColor)) {
        continue;
      }
      if (keyword === 'end') {
        continue;
      }
    }

    if (st.kind === 'block_statement' && st.type === 'ref_single') {
      // Inline ref: push as a single-row fragment frame (not a note)
      const targets = Array.isArray(st.targets) ? st.targets : [];
      // Auto-register participants referenced by ref
      for (const t of targets) {
        const id = resolveParticipant(t);
        ensureParticipant(id, t, NodeType.Participant);
      }
      fragments.push({
        type: 'ref',
        label: st.text || '',
        startRow: row,
        endRow: row + 1,
        sections: [],
      });
      row++;
      lastPushType = 'note';
      continue;
    }

    if (st.kind === 'block_statement' && st.type === 'ref_start') {
      refBlock = {
        type: 'ref',
        label: '',
        startRow: row,
        sections: [],
      };
      continue;
    }

    if (st.kind === 'note_statement') {
      const participants = [];
      if (Array.isArray(st.targets)) participants.push(...st.targets);
      if (st.target) participants.push(st.target);
      const pos = notePositionFromStatement(st, strict);
      // 'note left/right' without target attaches to the previous message
      const hasExplicitTarget = participants.length > 0;
      if (!hasExplicitTarget && (pos === 'left' || pos === 'right') && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (pos === 'left') {
          // Left side of the arrow = the leftmost participant
          const leftP = participantOrder.indexOf(lastMsg.from) <= participantOrder.indexOf(lastMsg.to) ? lastMsg.from : lastMsg.to;
          participants.push(leftP);
        } else {
          // Right side of the arrow = the rightmost participant
          const rightP = participantOrder.indexOf(lastMsg.from) >= participantOrder.indexOf(lastMsg.to) ? lastMsg.from : lastMsg.to;
          participants.push(rightP);
        }
      }
      const attached = !hasExplicitTarget && (pos === 'left' || pos === 'right');
      pushNote(pos, participants, st.text || '', 'note', st.color || null, !!st.across, !!st.async, attached);
      continue;
    }

    if (st.kind === 'hnote') {
      const participants = Array.isArray(st.targets) ? st.targets : [];
      pushNote('over', participants, st.text || '', 'hnote', null, !!st.across);
      continue;
    }

    if (st.kind === 'note_start' || (st.kind === 'block_statement' && (st.type === 'rnote_start' || st.type === 'hnote_start'))) {
      const isRnote = st.kind === 'block_statement' && st.type === 'rnote_start';
      const isHnote = st.kind === 'block_statement' && st.type === 'hnote_start';
      const participants = [];
      if (Array.isArray(st.targets)) participants.push(...st.targets);
      if (st.target) participants.push(st.target);
      const pos = notePositionFromStatement(st, strict);
      // 'note left/right' without target attaches to the previous message
      const hasExplicitTarget2 = participants.length > 0;
      if (!hasExplicitTarget2 && (pos === 'left' || pos === 'right') && messages.length > 0) {
        const lastMsg = messages[messages.length - 1];
        if (pos === 'left') {
          const leftP = participantOrder.indexOf(lastMsg.from) <= participantOrder.indexOf(lastMsg.to) ? lastMsg.from : lastMsg.to;
          participants.push(leftP);
        } else {
          const rightP = participantOrder.indexOf(lastMsg.from) >= participantOrder.indexOf(lastMsg.to) ? lastMsg.from : lastMsg.to;
          participants.push(rightP);
        }
      }
      noteBlock = {
        position: pos,
        participants,
        lines: [],
        noteType: isHnote ? 'hnote' : isRnote ? 'rnote' : 'note',
        color: st.color || null,
        concurrent: !!st.async,
        attachedToMsg: !hasExplicitTarget2 && (pos === 'left' || pos === 'right'),
      };
      continue;
    }

    if (isSequenceMessageStatement(st)) {
      if (st.type === 'sequence_start_message') {
        pushMessage('__external_left__', st.target, st.label || '', st.arrow, st.arrowMeta || null);
        continue;
      }
      if (st.type === 'sequence_end_message') {
        pushMessage(st.from, '__external_right__', st.label || '', st.arrow, st.arrowMeta || null);
        continue;
      }

      // Record Teoz tag for duration constraints
      if (st.tag) {
        const fromId = resolveParticipant(st.from);
        const toId = resolveParticipant(st.to);
        tagRowMap.set(st.tag, { row, fromParticipant: fromId, toParticipant: toId });
      }

      const label = st.type === 'sequence_message'
        ? (st.text || '')
        : (st.label || st.text || '');
      const delay = st.delay ? parseInt(st.delay, 10) || 0 : 0;
      const concurrent = !!st.async || st.type === 'async_message';
      pushMessage(st.from, st.to, label, st.arrow, st.arrowMeta || null, { decor: st.decor, color: st.color || undefined, delay, concurrent });
      continue;
    }

    if (st.kind === 'generic_statement' && st.type === 'usecase_relation') {
      pushMessage(st.from, st.to, st.label || '', st.arrow, st.arrowMeta || null, { color: st.style || undefined });
      continue;
    }

    if (st.kind === 'generic_statement' && st.type === 'sequence_message_alias') {
      const alias = normalizeId(st.toAlias || st.toLabel || '');
      const label = st.toLabel || '';
      if (alias) {
        ensureParticipant(alias, label || alias, NodeType.Participant);
        pushMessage(st.from, alias, '', st.arrow, st.arrowMeta || null);
        continue;
      }
    }

    if (st.kind === 'relation_statement') {
      pushMessage(st.from, st.to, st.label || '', st.arrow, st.arrowMeta || null);
      continue;
    }

    if (st.kind === 'arrow_statement') {
      if (st.from && st.to) {
        pushMessage(st.from, st.to, st.label || '', st.arrow);
        continue;
      }
    }

    if (strict) {
      const lineNumber = Number.isFinite(st.line) ? st.line : 0;
      const raw = String(st.raw || '').trim() || JSON.stringify(st);
      throw new Error(`Unsupported sequence statement at line ${lineNumber}: ${raw}`);
    }
  }

  for (const [participant, stack] of activationStack.entries()) {
    for (const active of stack) {
      activations.push({
        participant,
        startRow: active.startRow,
        endRow: Math.max(active.startRow + 1, row),
        color: active.color,
      });
    }
  }

  const participants = participantOrder
    .map((id) => participantMap.get(id))
    .filter(Boolean);

  // Sort by explicit order if any participant has one
  const hasOrder = participants.some((p) => p.order != null);
  if (hasOrder) {
    participants.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  }

  const titleText = titleLines.length > 0
    ? titleLines.map(l => l.trim()).filter(Boolean).join('\n')
    : undefined;

  return {
    diagramType: 'sequence',
    participants,
    messages,
    activations,
    fragments,
    dividers,
    durationConstraints,
    notes,
    boxes,
    mainframe: mainframeLabel,
    hideFootbox,
    responseMessageBelowArrow,
    stereotypePosition,
    participantAlign,
    title: titleText,
  };
}
