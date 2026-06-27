import { parseClassDiagram } from './class.ts';
import { lookupC4BoundaryMacro } from './c4-macros.ts';
import { PeggySyntaxError, parse as parsePeggy } from './puml-peggy.ts';

function safeMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return String(error);
}

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

function parseStatementLine(rawLine) {
  const input = `${String(rawLine || '')}\n`;
  return parsePeggy(input, { startRule: 'StatementLine' });
}



function isTimingHintStatement(st) {
  if (!st || typeof st !== 'object') return false;
  if (st.kind === 'declaration_statement' && st.type === 'timing_decl') return true;
  if (st.kind === 'generic_statement' && st.type === 'timing_at') return true;
  return false;
}

function hasTimingHintsFromPeggy(bodyLines) {
  for (const rawLine of bodyLines) {
    const trimmed = String(rawLine || '').trim();
    if (!trimmed) continue;
    try {
      const st = parseStatementLine(rawLine);
      if (isTimingHintStatement(st)) return true;
    } catch {
      // ignore parse failures during mode probing
    }
  }
  return false;
}

export function parsePlantUml(text) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);

  function jsonBraceDelta(line) {
    const s = String(line || '');
    let delta = 0;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') delta += 1;
      else if (ch === '}') delta -= 1;
    }
    return delta;
  }

  let startDirective = null;
  let startName = null;
  let endDirective = null;

  let startLine = 0;
  let endLine = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const d = parseDirectiveLine('start', lines[i]);
    if (!d) continue;
    startDirective = d.directive;
    startName = d.name;
    startLine = i + 1;
    break;
  }

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const d = parseDirectiveLine('end', lines[i]);
    if (!d) continue;
    endDirective = d.directive;
    endLine = i;
    break;
  }

  const bodyLines = lines.slice(startLine, endLine);
  const statements = [];
  const errors = [];

  const directiveLower = String(startDirective || '').toLowerCase();
  const isTimingHint = hasTimingHintsFromPeggy(bodyLines);
  const parseMode = directiveLower === '@startmindmap' || directiveLower === '@startwbs'
    ? 'mindmap'
    : (directiveLower === '@startgantt'
      ? 'default'
      : (directiveLower && directiveLower !== '@startuml'
        ? 'verbatim'
        : (isTimingHint ? 'timing' : 'default')));

  let inNoteBlock = false;
  let inActivityTextBlock = false;
  let inArrowLabelBlock = false;
  let styleBlockDepth = 0;
  let inStyleTag = false;
  let styleTagBraceDepth = 0;
  let inQuoteBlock = false;
  let inLegendBlock = false;
  let classBlockDepth = 0;
  let jsonBlockDepth = 0;
  let jsonBlockLines: string[] = [];
  let jsonStartStatement: any = null;
  let componentBracketDepth = 0;
  let componentBracketLines: string[] = [];
  let componentBracketStartStatement: any = null;
  let spriteBlockDepth = 0;
  let inTitleBlock = false;
  let mapBlockDepth = 0;
  let mapStartStatement: any = null;
  let mapEntries: any[] = [];
  let entityBlockDepth = 0;
  let stateBlockDepth = 0;
  let saltPending = false;
  let saltBlockDepth = 0;
  let saltLayoutDepth = 0;
  let inRNoteBlock = false;
  let inHNoteBlock = false;
  let inRefBlock = false;
  let inBlockComment = false;
  let quoteBlockLines: string[] = [];
  let quoteBlockStartLine = 0;

  // Mindmap multi-line node and style block state
  let mindmapMultiLine: any = null;
  let mindmapMultiLines: string[] = [];
  let mindmapStyleBlock = false;
  let mindmapStyleLines: string[] = [];

  // Multi-line note block merge buffer: collect text lines and attach to the
  // start statement so downstream parsers see a single statement with `text`.
  let noteBlockStartSt: any = null;
  let noteBlockTextLines: string[] = [];

  for (let i = 0; i < bodyLines.length; i += 1) {
    const rawLine = String(bodyLines[i] || '');
    const trimmed = rawLine.trim();
    const lineNumber = startLine + i + 1;

    // Handle block comments /' ... '/
    if (inBlockComment) {
      statements.push({ kind: 'comment_line', line: lineNumber, raw: rawLine, comment: rawLine });
      if (trimmed.includes("'/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("\/'" ) && !trimmed.includes("'/")) {
      inBlockComment = true;
      statements.push({ kind: 'comment_line', line: lineNumber, raw: rawLine, comment: rawLine });
      continue;
    }

    if (!trimmed) {
      statements.push({ kind: 'blank_line', line: lineNumber, raw: rawLine });
      continue;
    }

    if (parseMode === 'mindmap') {
      // Multi-line node continuation: collect lines until ';'
      if (mindmapMultiLine) {
        if (trimmed.endsWith(';')) {
          mindmapMultiLines.push(rawLine.replace(/;\s*$/, ''));
          mindmapMultiLine.text = mindmapMultiLines.join('\n');
          statements.push(mindmapMultiLine);
          mindmapMultiLine = null;
          mindmapMultiLines = [];
        } else {
          mindmapMultiLines.push(rawLine);
        }
        continue;
      }

      // <style>...</style> block
      if (mindmapStyleBlock) {
        if (trimmed === '</style>') {
          mindmapStyleBlock = false;
          statements.push({ kind: 'mindmap_style_block', line: lineNumber, raw: rawLine, text: mindmapStyleLines.join('\n') });
        } else {
          mindmapStyleLines.push(rawLine);
        }
        continue;
      }
      if (trimmed === '<style>') {
        mindmapStyleBlock = true;
        mindmapStyleLines = [];
        continue;
      }

      // Directives: left side, direction, title, caption, header/footer, legend
      const trimLower = trimmed.toLowerCase();
      if (trimLower === 'left side' || trimLower === 'right side') {
        statements.push({ kind: 'mindmap_side', line: lineNumber, raw: rawLine, side: trimLower === 'left side' ? 'left' : 'right' });
        continue;
      }
      if (trimLower === 'top to bottom direction' || trimLower === 'left to right direction' || trimLower === 'right to left direction') {
        statements.push({ kind: 'mindmap_direction', line: lineNumber, raw: rawLine, direction: trimLower });
        continue;
      }
      if (/^title\s+/i.test(trimmed)) {
        statements.push({ kind: 'mindmap_title', line: lineNumber, raw: rawLine, text: trimmed.replace(/^title\s+/i, '') });
        continue;
      }
      if (/^caption\s+/i.test(trimmed)) {
        statements.push({ kind: 'mindmap_caption', line: lineNumber, raw: rawLine, text: trimmed.replace(/^caption\s+/i, '') });
        continue;
      }

      // Skip header/footer/legend blocks
      if (/^(header|footer|legend)\b/i.test(trimLower) || /^end(header|footer|legend)/i.test(trimLower)
        || /^center\s+footer\b/i.test(trimLower)) {
        statements.push({ kind: 'mindmap_text_line', line: lineNumber, raw: rawLine, text: rawLine });
        continue;
      }

      // Node line: markers are *, +, -, # followed by optional _ (boxless), [#color], <<stereotype>>
      // Match against raw line to preserve leading indentation info
      const m = rawLine.match(/^(\s*)([*+\-#]+)(_?)\s*(?:\[([^\]]*)\])?\s*(:?)(.*)$/);
      if (m) {
        const indent = m[1].length;
        const markers = m[2];
        const boxless = m[3] === '_';
        const color = m[4] || null;
        const hasColon = Boolean(m[5]);
        let text = String(m[6] || '').trim();

        // Determine side from marker character
        const marker = markers[0];
        let side = null as string | null;
        if (marker === '-') side = 'left';
        else if (marker === '+') side = 'right';
        // * and # follow current side context

        // Extract <<stereotype>> from text end
        let stereotype = null as string | null;
        const stMatch = text.match(/\s*<<([^>]*)>>\s*$/);
        if (stMatch) {
          stereotype = stMatch[1];
          text = text.slice(0, -stMatch[0].length);
        }

        const st: any = {
          kind: 'mindmap_node_line', line: lineNumber, raw: rawLine,
          level: markers.length, indent, marker, side, boxless, color,
          colon: hasColon, text, stereotype,
        };

        if (hasColon) {
          // Multi-line node: collect until ';'
          if (text.endsWith(';')) {
            st.text = text.slice(0, -1);
            statements.push(st);
          } else {
            mindmapMultiLine = st;
            mindmapMultiLines = [text];
          }
        } else {
          statements.push(st);
        }
      } else {
        statements.push({ kind: 'mindmap_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      }
      continue;
    }

    if (parseMode === 'timing') {
      statements.push({ kind: 'timing_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (parseMode === 'verbatim') {
      statements.push({ kind: 'verbatim_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (saltPending) {
      if (trimmed === '{') {
        saltPending = false;
        saltBlockDepth = 1;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'salt_block_start' });
        continue;
      }
      saltPending = false;
    }

    if (saltBlockDepth > 0) {
      if (trimmed === '}' && saltBlockDepth === 1) {
        saltBlockDepth = 0;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'salt_block_end' });
        continue;
      }
      saltBlockDepth += jsonBraceDelta(rawLine);
      statements.push({ kind: 'salt_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (saltLayoutDepth > 0) {
      if (trimmed === '}' && saltLayoutDepth === 1) {
        saltLayoutDepth = 0;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'salt_layout_end' });
        continue;
      }
      saltLayoutDepth += jsonBraceDelta(rawLine);
      statements.push({ kind: 'salt_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (inNoteBlock) {
      // Only 'end note' closes the block; everything else is collected as note text.
      try {
        const st = parseStatementLine(rawLine);
        if (st && typeof st === 'object') {
          st.line = lineNumber;
          st.raw = rawLine;
        }
        if (st && st.kind === 'note_end') {
          inNoteBlock = false;
          // Merge collected text into the note_start statement
          if (noteBlockStartSt) {
            noteBlockStartSt.text = noteBlockTextLines.join('\n');
            statements.push(noteBlockStartSt);
            noteBlockStartSt = null;
            noteBlockTextLines = [];
          }
          continue;
        }
      } catch {
        // ignore and treat as plain note text
      }

      noteBlockTextLines.push(rawLine);
      continue;
    }

    if (inRNoteBlock) {
      try {
        const st = parseStatementLine(rawLine);
        if (st && typeof st === 'object') {
          st.line = lineNumber;
          st.raw = rawLine;
        }
        if (st && st.kind === 'block_statement' && st.type === 'rnote_end') {
          inRNoteBlock = false;
          if (noteBlockStartSt) {
            noteBlockStartSt.text = noteBlockTextLines.join('\n');
            statements.push(noteBlockStartSt);
            noteBlockStartSt = null;
            noteBlockTextLines = [];
          }
          continue;
        }
      } catch {
        // ignore
      }

      noteBlockTextLines.push(rawLine);
      continue;
    }

    if (inHNoteBlock) {
      try {
        const st = parseStatementLine(rawLine);
        if (st && typeof st === 'object') {
          st.line = lineNumber;
          st.raw = rawLine;
        }
        if (st && st.kind === 'block_statement' && st.type === 'hnote_end') {
          inHNoteBlock = false;
          if (noteBlockStartSt) {
            noteBlockStartSt.text = noteBlockTextLines.join('\n');
            statements.push(noteBlockStartSt);
            noteBlockStartSt = null;
            noteBlockTextLines = [];
          }
          continue;
        }
      } catch {
        // ignore
      }

      noteBlockTextLines.push(rawLine);
      continue;
    }

    if (inRefBlock) {
      try {
        const st = parseStatementLine(rawLine);
        if (st && typeof st === 'object') {
          st.line = lineNumber;
          st.raw = rawLine;
        }
        if (st && st.kind === 'block_statement' && st.type === 'ref_end') {
          inRefBlock = false;
          statements.push(st);
          continue;
        }
      } catch {
        // ignore
      }

      statements.push({ kind: 'ref_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (inLegendBlock) {
      try {
        const st = parseStatementLine(rawLine);
        if (st && typeof st === 'object') {
          st.line = lineNumber;
          st.raw = rawLine;
        }
        if (st && st.kind === 'block_statement' && st.type === 'legend_end') {
          inLegendBlock = false;
          statements.push(st);
          continue;
        }
      } catch {
        // ignore
      }

      statements.push({ kind: 'legend_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (inTitleBlock) {
      try {
        const st = parseStatementLine(rawLine);
        if (st && typeof st === 'object') {
          st.line = lineNumber;
          st.raw = rawLine;
        }
        if (st && st.kind === 'block_statement' && st.type === 'title_end') {
          inTitleBlock = false;
          statements.push(st);
          continue;
        }
      } catch {
        // ignore
      }

      statements.push({ kind: 'title_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (jsonBlockDepth > 0) {
      if (trimmed === '}' && jsonBlockDepth === 1) {
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'json_block_end' });

        const jsonText = `\n{\n${jsonBlockLines.join('\n')}\n}`;
        try {
          const parsed = JSON.parse(jsonText);
          if (jsonStartStatement && typeof jsonStartStatement === 'object') {
            jsonStartStatement.json = parsed;
          }
        } catch {
          // Intentionally ignore JSON.parse failures (PlantUML JSON blocks may allow extensions).
        }

        jsonBlockDepth = 0;
        jsonBlockLines = [];
        jsonStartStatement = null;
        continue;
      }

      jsonBlockLines.push(rawLine);
      jsonBlockDepth += jsonBraceDelta(rawLine);
      statements.push({ kind: 'json_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (mapBlockDepth > 0) {
      if (trimmed === '}' && mapBlockDepth === 1) {
        // Attach accumulated entries to the start statement
        if (mapStartStatement) {
          mapStartStatement.entries = mapEntries.slice();
        }
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'map_block_end' });
        mapBlockDepth = 0;
        mapStartStatement = null;
        mapEntries = [];
        continue;
      }
      mapBlockDepth += jsonBraceDelta(rawLine);
      // Parse map entry lines through peggy for structured extraction
      try {
        const st = parsePeggy(`${rawLine}\n`, { startRule: 'MapEntryLine' });
        if (st && st.kind === 'map_entry') {
          mapEntries.push(st);
        }
      } catch {
        // Unparseable line — treat as plain key
        if (trimmed) mapEntries.push({ kind: 'map_entry', key: trimmed, value: '' });
      }
      continue;
    }

    if (componentBracketDepth > 0) {
      const closeIndex = rawLine.indexOf(']');
      if (trimmed === ']') {
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'component_bracket_end' });
        componentBracketDepth = 0;
        if (componentBracketStartStatement && typeof componentBracketStartStatement === 'object') {
          componentBracketStartStatement.lines = componentBracketLines.slice();
        }
        componentBracketLines = [];
        componentBracketStartStatement = null;
        continue;
      }

      if (closeIndex >= 0) {
        const head = rawLine.slice(0, closeIndex);
        if (head) componentBracketLines.push(head);
        statements.push({ kind: 'component_text_line', line: lineNumber, raw: rawLine, text: rawLine });
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'component_bracket_end' });
        componentBracketDepth = 0;
        if (componentBracketStartStatement && typeof componentBracketStartStatement === 'object') {
          componentBracketStartStatement.lines = componentBracketLines.slice();
        }
        componentBracketLines = [];
        componentBracketStartStatement = null;
        continue;
      }

      componentBracketLines.push(rawLine);
      statements.push({ kind: 'component_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (spriteBlockDepth > 0) {
      if (trimmed === '}') {
        spriteBlockDepth = 0;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'sprite_block_end' });
        continue;
      }
      statements.push({ kind: 'sprite_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (entityBlockDepth > 0) {
      if (trimmed === '}' && entityBlockDepth === 1) {
        entityBlockDepth = 0;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'entity_block_end' });
        continue;
      }
      entityBlockDepth += jsonBraceDelta(rawLine);
      statements.push({ kind: 'entity_body_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (stateBlockDepth > 0) {
      if (trimmed === '}') {
        stateBlockDepth -= 1;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'state_block_end' });
        continue;
      }
      // Parse state body lines as regular statements for nested support
      let parsedState: any = null;
      try { parsedState = parseStatementLine(rawLine); } catch { /* ignore */ }
      if (parsedState && typeof parsedState === 'object') {
        parsedState.line = lineNumber;
        parsedState.raw = rawLine;
        // Detect nested state block start
        if ((parsedState.kind === 'declaration_statement' || parsedState.kind === 'class_declaration') &&
            String(parsedState.type || '').toLowerCase() === 'state' && parsedState.block === true) {
          stateBlockDepth += 1;
        }
        statements.push(parsedState);
      } else if (trimmed) {
        statements.push({ kind: 'state_body_line', line: lineNumber, raw: rawLine, text: rawLine });
      }
      continue;
    }

    if (classBlockDepth > 0) {
      if (trimmed === '}') {
        classBlockDepth -= 1;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'class_block_end' });
        continue;
      }

      // Try PEG parsing to extract {field}/{method}/{static}/{abstract} tags and visibility
      let parsed = null;
      try { parsed = parseStatementLine(rawLine); } catch { /* ignore */ }
      if (parsed && parsed.kind === 'declaration_statement' && parsed.type === 'member' && parsed.tag) {
        statements.push({ kind: 'class_body_line', line: lineNumber, raw: rawLine, text: rawLine, tag: parsed.tag, visibility: parsed.visibility || '', memberText: parsed.text || '' });
      } else {
        statements.push({ kind: 'class_body_line', line: lineNumber, raw: rawLine, text: rawLine });
      }
      continue;
    }

    // <style> ... </style> tag block: use simple brace counting instead of
    // PEG parsing, because PEG's StyleBlockStartLine excludes ComponentType
    // keywords (actor, agent, etc.) which are valid CSS selector names.
    if (inStyleTag) {
      if (/^\s*<\/style>/i.test(trimmed)) {
        inStyleTag = false;
        styleTagBraceDepth = 0;
        statements.push({ kind: 'markup_statement', line: lineNumber, raw: rawLine, text: '</style>' });
        continue;
      }
      if (trimmed.endsWith('{')) {
        const name = trimmed.slice(0, -1).trim();
        styleTagBraceDepth += 1;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'style_block_start', name });
        continue;
      }
      if (trimmed === '}') {
        styleTagBraceDepth -= 1;
        statements.push({ kind: 'block_statement', line: lineNumber, raw: rawLine, type: 'style_block_end' });
        continue;
      }
      statements.push({ kind: 'style_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (styleBlockDepth > 0) {
      try {
        const st = parseStatementLine(rawLine);
        if (st && typeof st === 'object') {
          st.line = lineNumber;
          st.raw = rawLine;
        }
        if (st && st.kind === 'block_statement' && (st.type === 'style_block_start' || st.type === 'loose_block_start' || st.block === true)) {
          styleBlockDepth += 1;
          statements.push({ kind: 'style_text_line', line: lineNumber, raw: rawLine, text: rawLine });
          continue;
        }
        if (st && st.kind === 'block_statement' && st.type === 'style_block_end') {
          styleBlockDepth -= 1;
          statements.push(st);
          continue;
        }
      } catch {
        // ignore and treat as style text
      }

      statements.push({ kind: 'style_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      continue;
    }

    if (inQuoteBlock) {
      // Accumulate lines for multi-line quoted strings
      quoteBlockLines.push(rawLine);
      const quoteCount = (rawLine.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) {
        // Quotes balanced — join with literal \\n and re-parse
        inQuoteBlock = false;
        const joined = quoteBlockLines.join('\\n');
        try {
          const st = parseStatementLine(joined);
          if (st && typeof st === 'object') {
            st.line = quoteBlockStartLine;
            st.raw = quoteBlockLines.join('\n');
          }
          statements.push(st);
        } catch {
          // Join didn't help — push individual text lines
          for (let k = 0; k < quoteBlockLines.length; k++) {
            statements.push({ kind: 'string_text_line', line: quoteBlockStartLine + k, raw: quoteBlockLines[k], text: quoteBlockLines[k] });
          }
        }
        quoteBlockLines = [];
      }
      continue;
    }

    if (inActivityTextBlock) {
      // Activity multi-line text continues until a line containing ';'
      const hasEnd = rawLine.indexOf(';') !== -1;
      statements.push({ kind: 'activity_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      if (hasEnd) inActivityTextBlock = false;
      continue;
    }

    if (inArrowLabelBlock) {
      const hasEnd = rawLine.indexOf(';') !== -1;
      statements.push({ kind: 'arrow_text_line', line: lineNumber, raw: rawLine, text: rawLine });
      if (hasEnd) inArrowLabelBlock = false;
      continue;
    }

    // Pre-detect unbalanced quotes (multi-line string) before PEG parsing
    {
      const quoteCount = (rawLine.match(/"/g) || []).length;
      if (quoteCount % 2 === 1) {
        inQuoteBlock = true;
        quoteBlockLines = [rawLine];
        quoteBlockStartLine = lineNumber;
        continue;
      }
    }

    try {
      const st = parseStatementLine(rawLine);
      if (st && typeof st === 'object') {
        st.line = lineNumber;
        st.raw = rawLine;
      }
      if (st && st.kind === 'note_start') {
        inNoteBlock = true;
        noteBlockStartSt = st;
        noteBlockTextLines = [];
      }
      if (st && st.kind === 'block_statement' && st.type === 'rnote_start') {
        inRNoteBlock = true;
        noteBlockStartSt = st;
        noteBlockTextLines = [];
      }
      if (st && st.kind === 'block_statement' && st.type === 'hnote_start') {
        inHNoteBlock = true;
        noteBlockStartSt = st;
        noteBlockTextLines = [];
      }
      if (st && st.kind === 'block_statement' && st.type === 'ref_start') {
        inRefBlock = true;
      }
      if (st && st.kind === 'block_statement' && st.type === 'style_block_start') {
        // 'together { }' is a transparent grouping hint — pass through so
        // content inside is parsed normally.
        if (!/^together$/i.test(String(st.name || ''))) {
          styleBlockDepth = 1;
        }
      }
      if (st && st.kind === 'block_statement' && st.type === 'loose_block_start') {
        // C4 boundary macros: "System_Boundary(id, label) {" — pass through
        // so content inside is parsed normally (like 'together').
        const looseText = String(st.text || '');
        const macroMatch = looseText.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (!(macroMatch && lookupC4BoundaryMacro(macroMatch[1]))) {
          styleBlockDepth = 1;
        }
      }
      // <style> tag triggers inStyleTag mode — all lines until </style>
      // are parsed with simple brace counting (bypassing PEG) so that
      // component-type keywords (actor, agent, etc.) used as CSS selectors
      // are not misinterpreted as node declarations.
      if (st && st.kind === 'markup_statement' && /^<style>/i.test(String(st.text || ''))) {
        inStyleTag = true;
        statements.push(st);
        continue;
      }
      if (st && st.kind === 'block_statement' && st.type === 'legend_start') {
        inLegendBlock = true;
      }
      if (st && st.kind === 'block_statement' && st.type === 'title_start') {
        inTitleBlock = true;
      }
      if (st && st.kind === 'block_statement' && st.type === 'json_block_start') {
        jsonBlockDepth = 1;
        jsonBlockLines = [];
        jsonStartStatement = st;
      }
      if (st && st.kind === 'block_statement' && st.type === 'map_block_start') {
        mapBlockDepth = 1;
        mapStartStatement = st;
        mapEntries = [];
      }
      if (st && st.kind === 'block_statement' && st.type === 'salt_start') {
        saltPending = true;
      }
      if (st && st.kind === 'block_statement' && st.type === 'salt_layout_start') {
        saltLayoutDepth = 1;
      }
      if (st && st.kind === 'block_statement' && st.type === 'component_bracket_start') {
        componentBracketDepth = 1;
        componentBracketLines = [];
        if (st && typeof st === 'object' && st.head) componentBracketLines.push(String(st.head));
        componentBracketStartStatement = st;
      }
      if (st && st.kind === 'preprocessor_statement' && String(st.cmd || '').toLowerCase() === 'sprite' && st.block === true) {
        spriteBlockDepth = 1;
      }
      if (st && st.kind === 'directive_statement' && String(st.keyword || '').toLowerCase() === 'skinparam' && st.block === true) {
        styleBlockDepth = 1;
      }
      if (st && (st.kind === 'declaration_statement' || st.kind === 'class_declaration')) {
        const t = String(st.type || '').toLowerCase();
        if ((t === 'class' || t === 'interface' || t === 'enum' || t === 'object') && st.block === true) {
          classBlockDepth = 1;
        }
        if (t === 'state' && st.block === true) {
          stateBlockDepth = 1;
        }
      }
      if (st && st.kind === 'component_statement') {
        const t = String(st.componentType || '').toLowerCase();
        if (t === 'entity' && st.block === true) {
          entityBlockDepth = 1;
        }
      }
      if (st && st.kind === 'activity_statement') {
        if (st.type !== 'return' && st.terminated === false) {
          inActivityTextBlock = true;
        }
      }
      if (st && st.kind === 'arrow_statement') {
        const hasEnd = rawLine.indexOf(';') !== -1;
        inArrowLabelBlock = !hasEnd && st.multilineLabel === true;
      }

      // Note block start statements are deferred — pushed when note_end is found
      if (!noteBlockStartSt) {
        statements.push(st);
      }
    } catch (error) {
      // Recovery for single-line empty blocks, e.g.:
      //   package "User" as ent_user {}
      // Some legal forms are rejected by strict StatementLine parsing.
      // Rewrite to an open block + synthetic closing block so downstream
      // parsers keep parent/child group structure intact.
      if (/\{\s*\}\s*$/.test(trimmed)) {
        const openOnly = rawLine.replace(/\{\s*\}\s*$/, '{');
        try {
          const openSt = parseStatementLine(openOnly);
          if (openSt && typeof openSt === 'object' && openSt.block === true) {
            openSt.line = lineNumber;
            openSt.raw = openOnly;
            statements.push(openSt);
            statements.push({ kind: 'block_statement', line: lineNumber, raw: '}', type: 'style_block_end' });
            continue;
          }
        } catch {
          // fall through to normal error recording below
        }
      }
      const code = error instanceof PeggySyntaxError ? 'PEGGY_SYNTAX_ERROR' : 'STRICT_PARSE_ERROR';
      errors.push({
        line: lineNumber,
        code,
        message: safeMessage(error),
        content: trimmed,
      });
    }
  }

  const relations = [];
  const components = [];
  for (const statement of statements) {
    if (statement.kind === 'relation_statement') relations.push(statement);
    if (statement.kind === 'component_statement') components.push(statement);
  }

  let classModel = { nodes: [], edges: [], groups: [], errors: [] } as any;
  if (directiveLower === '@startuml' && parseMode === 'default') {
    classModel = parseClassDiagram(statements);
  }
  if (Array.isArray(classModel.errors) && classModel.errors.length > 0) {
    errors.push(...classModel.errors);
  }

  return {
    type: 'document',
    startDirective,
    startName,
    endDirective,
    statements,
    errors,
    semantic: {
      nodes: classModel.nodes,
      edges: classModel.edges,
      groups: classModel.groups || [],
      relations,
      components,
    },
  };
}
