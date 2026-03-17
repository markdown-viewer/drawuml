import { createTheme, type Theme } from '../shared/theme.ts';
import { TextBlock, type FontSpec } from '../shared/text-block.ts';
import { createRenderer } from '../primitives/index.ts';
import { getScaledParticipantConfig, buildParticipantLabel, measureBracketBody } from '../primitives/participant.ts';
import { Renderer } from '../primitives/renderer.ts';
import type { LayoutNote } from '../model/common.ts';

function getRowCount(model) {
  const rows = [];
  for (const m of model.messages || []) rows.push((m.row || 0) + 1);
  for (const d of model.dividers || []) rows.push((d.row || 0) + 1);
  for (const n of model.notes || []) rows.push((n.row || 0) + 1);
  for (const f of model.fragments || []) rows.push(f.endRow || 0);
  // fragment endRow is exclusive (one past the last content row),
  // so it already equals the needed row count.
  for (const a of model.activations || []) rows.push((a.endRow || 0));
  // activation endRow points to the deactivate/destroy directive row;
  // the bar visually ends at endRow-1 (last message row), so we only
  // need that row to exist — not endRow itself.
  return rows.length > 0 ? Math.max(...rows) : 0;
}

export function sequenceTableLayout(model, options?: { theme?: Theme }) {
  const theme = options?.theme ?? createTheme();
  const fontSize = theme.fontSize;
  const fontFamily = theme.fontFamily;
  const titleMinWidth = theme.sizeXL;
  const titlePadX = theme.padM;
  const titlePadY = theme.padS;
  const minGap = theme.padL;
  const marginX = model.mainframe ? minGap : 0;
  let marginTop = 0;
  const tabHeight = theme.sizeS;
  const unitGap = theme.padXL;
  const smallPad = theme.padXS;
  const extBoundaryGap = theme.padXL;

  // Title: compute height and push participants down by title height + gap
  const renderers = new Map<string, Renderer>();
  let titleLayout = null;
  if (model.title) {
    const titleRenderer = createRenderer('title', { id: 'diagram-title', label: model.title, theme });
    renderers.set('diagram-title', titleRenderer);
    const { width, height } = titleRenderer.measure();
    titleLayout = {
      x: 0, // will be centered after all content is laid out
      y: 0,
      width,
      height,
    };
    // measure() height already includes a bottom gap
    marginTop = height;
  }

  // Mainframe: reserve space for the frame tab + internal padding at the top
  const mainframeTopOffset = model.mainframe ? (tabHeight + minGap) : 0;
  marginTop += mainframeTopOffset;

  // Shared font spec for text measurement (all text goes through TextBlock)
  const seqFont: FontSpec = { size: fontSize, family: fontFamily };
  const measureLabel = (html: string) => TextBlock.fromHtml(html, seqFont).width + titlePadX;
  const measureHtmlWidth = (raw: string) => TextBlock.inline(raw, seqFont).width;

  const maxRowIndex = Math.max(getRowCount(model) - 1, 0);

  // Build ordered participant list and index lookup
  const pList = model.participants;
  const pIndex = {};
  pList.forEach((p, idx) => { pIndex[p.id] = idx; });

  // Use theme-scaled participant config for icon dimensions
  const pConfig = getScaledParticipantConfig(theme.sizeM);

  // Calculate dynamic participant sizes (width and height).
  // For icon types (actor, boundary, etc.) with external labels:
  //   geomWidth = icon width (narrow), visualWidth = max(iconW, labelW)
  //   iconHeight = fixed per type
  // For box types (participant, collections, queue):
  //   geomWidth = visualWidth = max(minParticipantWidth, labelW)
  //   iconHeight = based on text line count + padding
  const participantSizes = pList.map((p) => {
    const pcfg = pConfig[p.type] || pConfig.participant;
    const iconW = pcfg.iconW;
    const label = p.label || p.id;
    const displayLabel = buildParticipantLabel(p, { stereotypePosition: model.stereotypePosition, fontSize, spotSize: theme.sizeS, spotFontSize: theme.spotFontSize, spotMargin: theme.padXS });
    const labelW = measureLabel(displayLabel);
    const baseH = pcfg.iconSize;
    if (iconW > 0) {
      // Icon type: geometry is just the icon, visual extent includes label, fixed height
      return { geomWidth: iconW, visualWidth: Math.max(iconW, labelW), iconHeight: baseH };
    }
    // Box type: geometry = visual, height adjusts for multiline text
    if (p.bracketLines && p.bracketLines.length > 0) {
      // Bracket body participant: measure rich content
      const bodySize = measureBracketBody(p.bracketLines, fontSize, fontFamily, theme);
      const w = Math.max(titleMinWidth, bodySize.width);
      const iconHeight = Math.max(baseH, bodySize.height);
      return { geomWidth: w, visualWidth: w, iconHeight };
    }
    const w = Math.max(titleMinWidth, labelW);
    const textH = TextBlock.fromHtml(displayLabel, seqFont).height;
    const boxPadding = titlePadY; // vertical padding inside box
    const iconHeight = Math.max(baseH, textH + boxPadding);
    return { geomWidth: w, visualWidth: w, iconHeight };
  });

  // Note sizing (using NoteRenderer for content measurement)
  // noteGap, actNestOffset, boxPad, fragmentMargin all unified as smallPad

  // Pre-compute content-based dimensions for each note
  const noteContentSizes = (model.notes || []).map((n, idx) => {
    const noteId = `note${idx + 1}`;
    const rawLines = (n.text || '').split('\n');
    const noteType = n.noteType || 'note';
    const r = createRenderer('note', { id: noteId, lines: rawLines, noteType, color: n.color, theme });
    renderers.set(noteId, r);
    const { width: w, height: h } = r.measure();
    return { width: w, height: h, row: n.row ?? 0 };
  });

  // Calculate per-gap minimum width based on message label lengths and
  // participant visual widths (to prevent label overlap).
  // Messages span center-to-center, so the available space for a label is:
  //   halfVisual(left) + gap + halfVisual(right) [+ intermediate visuals]
  const gapCount = Math.max(pList.length - 1, 0);
  const gapWidths = new Array(gapCount).fill(minGap);

  // Pre-compute max activation nesting depth per participant to account for
  // activation bar width extending past the participant center.
  const actBarWidth = theme.sizeXS;

  const selfRefLoopOffset = theme.sizeL;
  const maxActDepthByParticipant: Record<string, number> = {};
  for (const a of (model.activations || [])) {
    const cur = maxActDepthByParticipant[a.participant] || 0;
    // Count how many other activations of same participant enclose this one
    let depth = 0;
    for (const b of (model.activations || [])) {
      if (b !== a && b.participant === a.participant && b.startRow <= a.startRow && b.endRow >= a.endRow) {
        depth++;
      }
    }
    maxActDepthByParticipant[a.participant] = Math.max(cur, depth);
  }
  // Compute per-participant extensions past center due to activation bars.
  // Self-reference loops are handled separately in the message gap loop.
  const actExtend = pList.map((p) => {
    const maxDepth = maxActDepthByParticipant[p.id] || 0;
    if (maxDepth === 0 && !(model.activations || []).some(a => a.participant === p.id)) return 0;
    return maxDepth * smallPad + actBarWidth / 2;
  });

  // Track which created participants have had their create-message processed.
  // A create-message arrow targets the participant box edge (not center), so
  // the effective span is shorter by targetWidth/2 — we compensate with extra gap.
  const firstCreateMsgSeen = new Set<string>();

  for (const msg of model.messages) {
    const fi = pIndex[msg.from];
    const ti = pIndex[msg.to];
    if (fi === undefined || ti === undefined) continue;

    const isCreateMsg = pList[ti]?.createdAtRow != null && !firstCreateMsgSeen.has(msg.to);
    if (pList[ti]?.createdAtRow != null) firstCreateMsgSeen.add(msg.to);

    // Self-reference: ensure minimum gap on the loop side.
    // The loop extends selfRefLoopOffset from the activation bar edge,
    // which is already (geomWidth/2 - actBarWidth/2) inside the participant edge.
    if (msg.from === msg.to) {
      const dir = msg.arrowStyle?.direction || 'right';
      const inset = participantSizes[fi].geomWidth / 2 - actBarWidth / 2;
      const neededGap = selfRefLoopOffset - inset;
      if (neededGap > 0) {
        if (dir === 'right' && fi < gapCount) {
          gapWidths[fi] = Math.max(gapWidths[fi], neededGap);
        } else if (dir === 'left' && fi > 0) {
          gapWidths[fi - 1] = Math.max(gapWidths[fi - 1], neededGap);
        }
      }
      continue;
    }

    const lo = Math.min(fi, ti);
    const hi = Math.max(fi, ti);
    // Include space between number prefix and label to match the actual rendered text
    const rawLabel = msg.numberPrefix
      ? (msg.label ? msg.numberPrefix + ' ' + msg.label : msg.numberPrefix)
      : (msg.label || '');
    const labelWidth = measureHtmlWidth(rawLabel) + minGap;

    // Subtract endpoint half-widths and intermediate full widths.
    // Also account for activation bar extensions that eat into the gap space:
    // arrows start/end at activation bar edges, not participant centers.
    let available = participantSizes[lo].visualWidth / 2 + participantSizes[hi].visualWidth / 2;
    for (let k = lo + 1; k < hi; k++) available += participantSizes[k].visualWidth;
    // Activation bars reduce available space (they protrude into the gap)
    const fromActExt = actExtend[fi] || 0;
    // For create messages: target has no activation bar yet; arrow ends at box
    // left edge, not center. Replace toActExt with the full target half-width.
    const toActExt = isCreateMsg ? participantSizes[ti].visualWidth / 2 : (actExtend[ti] || 0);
    const requiredWidth = labelWidth + fromActExt + toActExt;
    const neededGapTotal = requiredWidth - available;

    if (hi - lo === 1) {
      // Direct neighbor: single gap must accommodate the label
      gapWidths[lo] = Math.max(gapWidths[lo], neededGapTotal);
    } else {
      // Multi-span: distribute needed gap evenly across spanned gaps
      const perGap = neededGapTotal / (hi - lo);
      for (let g = lo; g < hi; g++) {
        gapWidths[g] = Math.max(gapWidths[g], perGap);
      }
    }
  }

  // Ensure adjacent participant labels don't overlap:
  // gap must be >= (visualWidth[i] - geomWidth[i])/2 + (visualWidth[i+1] - geomWidth[i+1])/2
  // Also account for activation bar extensions past the participant center.
  for (let i = 0; i < gapCount; i++) {
    const leftOverhang = (participantSizes[i].visualWidth - participantSizes[i].geomWidth) / 2;
    const rightOverhang = (participantSizes[i + 1].visualWidth - participantSizes[i + 1].geomWidth) / 2;
    gapWidths[i] = Math.max(gapWidths[i], leftOverhang + rightOverhang);
    // Activation bar extension: right side of left participant + left side of right participant
    const actRight = actExtend[i];
    const actLeft = actExtend[i + 1];
    if (actRight > 0 || actLeft > 0) {
      const actGap = actRight + actLeft + minGap;
      gapWidths[i] = Math.max(gapWidths[i], actGap);
    }
  }

  // Expand gaps for concurrent notes on the same row to prevent overlap.
  // For each row, collect notes and sort by participant position, then ensure
  // adjacent notes have enough spacing between their anchoring participants.
  const noteOverlapMargin = theme.padS; // minimum pixel gap between concurrent notes
  const notesByRow: Record<number, { noteIdx: number; anchorLeft: number; anchorRight: number; extendLeft: number; extendRight: number }[]> = {};
  (model.notes || []).forEach((n, idx) => {
    if (n.across) return; // across notes span all participants, skip
    const p1Idx = n.participants?.[0] ? pIndex[n.participants[0]] : undefined;
    if (p1Idx === undefined) return;
    const p2Idx = n.participants?.[1] ? pIndex[n.participants[1]] : undefined;
    const noteW = noteContentSizes[idx].width;
    const row = n.row ?? 0;

    let anchorLeft: number, anchorRight: number, extendLeft: number, extendRight: number;
    if (n.position === 'over' && p2Idx !== undefined) {
      // Spanning note over two participants
      anchorLeft = Math.min(p1Idx, p2Idx);
      anchorRight = Math.max(p1Idx, p2Idx);
      // Overhang beyond the outer participants is (noteW - span) / 2,
      // but span is not yet known. Use conservative estimate: assume
      // the span contributes nothing, so full half-width extends each side.
      extendLeft = noteW / 2;
      extendRight = noteW / 2;
    } else if (n.position === 'over') {
      anchorLeft = anchorRight = p1Idx;
      extendLeft = noteW / 2;
      extendRight = noteW / 2;
    } else if (n.position === 'left') {
      anchorLeft = anchorRight = p1Idx;
      extendLeft = smallPad + noteW;
      extendRight = -smallPad;
    } else if (n.position === 'right') {
      anchorLeft = anchorRight = p1Idx;
      extendLeft = -smallPad;
      extendRight = smallPad + noteW;
    } else {
      return;
    }

    if (!notesByRow[row]) notesByRow[row] = [];
    notesByRow[row].push({ noteIdx: idx, anchorLeft, anchorRight, extendLeft, extendRight });
  });

  for (const row in notesByRow) {
    const rowNotes = notesByRow[row];
    if (rowNotes.length < 2) continue;
    // Sort by anchor position (leftmost participant first)
    rowNotes.sort((a, b) => a.anchorLeft - b.anchorLeft || a.anchorRight - b.anchorRight);

    for (let i = 0; i < rowNotes.length - 1; i++) {
      const noteA = rowNotes[i];
      const noteB = rowNotes[i + 1];
      // Only check if noteA's right anchor is to the left of noteB's left anchor (or same)
      const rightIdx = noteA.anchorRight;
      const leftIdx = noteB.anchorLeft;
      if (rightIdx > leftIdx) continue; // overlapping anchor ranges, skip

      // Required center-to-center distance between rightIdx and leftIdx:
      // noteA.extendRight + noteOverlapMargin + noteB.extendLeft
      const requiredDist = noteA.extendRight + noteOverlapMargin + noteB.extendLeft;

      if (rightIdx === leftIdx) {
        // Both notes anchor to the same participant — expand gaps on both sides
        // This case (e.g., "left of A" + "right of A") is handled by positioning, skip
        continue;
      }

      // Available distance = vw[rightIdx]/2 + sum(gaps[rightIdx..leftIdx-1]) + sum(vw[k] for k in rightIdx+1..leftIdx-1) + vw[leftIdx]/2
      let available = participantSizes[rightIdx].visualWidth / 2 + participantSizes[leftIdx].visualWidth / 2;
      for (let k = rightIdx + 1; k < leftIdx; k++) available += participantSizes[k].visualWidth;

      const neededGapTotal = requiredDist - available;
      if (neededGapTotal <= 0) continue;

      const spanCount = leftIdx - rightIdx;
      if (spanCount === 1) {
        gapWidths[rightIdx] = Math.max(gapWidths[rightIdx], neededGapTotal);
      } else {
        const perGap = neededGapTotal / spanCount;
        for (let g = rightIdx; g < leftIdx; g++) {
          gapWidths[g] = Math.max(gapWidths[g], perGap);
        }
      }
    }
  }

  // Compute cumulative x positions using geomWidth for geometry placement
  // and visualWidth for center calculation (center of visual extent)
  // Bottom-align icons: offset y so all icon bottoms are at the same level
  const iconHeights = pList.map((_, idx) => participantSizes[idx].iconHeight);
  const maxIconHeight = Math.max(...iconHeights);
  // Dynamic row start: icon bottom + unitGap
  const rowTop = marginTop + maxIconHeight + unitGap;

  // First pass: compute centerX positions (independent of message Ys)
  const centerXs = [];
  const centerXById = {};
  {
    let cx = marginX;
    pList.forEach((p, idx) => {
      const vw = participantSizes[idx].visualWidth;
      const centerX = cx + vw / 2;
      centerXs.push(centerX);
      centerXById[p.id] = centerX;
      if (idx < gapCount) cx += vw + gapWidths[idx];
    });
  }

  // Pre-scan external messages to check if left-boundary arrows need more space.
  // If a label is wider than the distance from leftBoundaryX(0) to its target,
  // we need extra left margin — shift all participants rightward.
  const minShortArrowLen = theme.sizeXL;
  const extLabelPadding = smallPad * 2;
  let extraLeftMargin = 0;
  for (const msg of model.messages) {
    const token = msg.arrowStyle?.token || '';
    const isBoundary = token.includes('[') || token.includes(']');
    const isLeftExt = msg.from === '__external_left__' || msg.to === '__external_left__';
    if (!isLeftExt) continue;

    const rawLabel = (msg.numberPrefix || '') + (msg.label || '');
    const labelW = rawLabel ? measureHtmlWidth(rawLabel) + extLabelPadding : 0;
    if (labelW <= 0) continue;

    // Find the real participant's centerX
    const realId = msg.from === '__external_left__' ? msg.to : msg.from;
    const realIdx = pIndex[realId];
    if (realIdx === undefined) continue;
    const cx = centerXs[realIdx];

    if (isBoundary) {
      // Boundary arrow: line goes from 0 to cx → need cx >= labelW
      const needed = labelW - cx;
      if (needed > 0) extraLeftMargin = Math.max(extraLeftMargin, needed);
    } else {
      // Short arrow: line is shortArrowLen from cx → just ensure shortArrowLen >= labelW (handled later)
    }
  }

  // Apply extra left margin by shifting all centerXs
  if (extraLeftMargin > 0) {
    for (let i = 0; i < centerXs.length; i++) {
      centerXs[i] += extraLeftMargin;
    }
    for (const id in centerXById) {
      centerXById[id] += extraLeftMargin;
    }
  }

  // Build map: row -> max note height at that row
  const noteHeightByRow = {};
  for (const ns of noteContentSizes) {
    noteHeightByRow[ns.row] = Math.max(noteHeightByRow[ns.row] || 0, ns.height);
  }

  // Determine the total number of rows
  const totalRows = getRowCount(model);

  // Build map: row -> divider content half-height (above/below center)
  // Measured from actual label text height; the rendered box uses this value.
  const dividerHalfHeightByRow: Record<number, number> = {};
  for (const d of (model.dividers || [])) {
    if (d.type === 'ellipsis') continue; // invisible spacer, no own height
    const row = d.row ?? 0;
    const labelH = d.label
      ? TextBlock.inline(d.label, seqFont).height
      : 0;
    const halfH = Math.max(smallPad, Math.ceil(labelH / 2) + smallPad);
    dividerHalfHeightByRow[row] = Math.max(dividerHalfHeightByRow[row] || 0, halfH);
  }

  // Build maps: row -> label height above/below the arrow.
  // When responseMessageBelowArrow is true, leftward (response) messages render
  // their label below the arrow, so their label height contributes to the
  // below-center space instead of above-center.
  // Scale factor for timed (slanted) message delay values
  const delayScale = theme.strokeWidth;

  const responseBelow = !!model.responseMessageBelowArrow;
  const msgLabelHeightByRow = {};      // any label height (for hasMsg check)
  const msgLabelAboveByRow = {};       // label height above arrow
  const msgLabelBelowByRow = {};       // label height below arrow
  // Track rows containing self-reference messages (arrow extends below centerline)
  const selfRefDropByRow = {};
  const selfRefDrop = minGap; // self-reference arrow target is centerY + selfRefDrop
  // Track rows containing timed/slanted messages (arrow target is below source)
  const timedDropByRow = {};
  for (const msg of model.messages) {
    const rawLabel = (msg.numberPrefix || '') + (msg.label || '');
    const labelH = rawLabel ? TextBlock.inline(rawLabel, seqFont).height : 0;
    const row = msg.row;
    msgLabelHeightByRow[row] = Math.max(msgLabelHeightByRow[row] || 0, labelH);

    // Determine if label renders below the arrow
    const fromCx = centerXById[msg.from];
    const toCx = centerXById[msg.to];
    const isLeftward = fromCx !== undefined && toCx !== undefined && fromCx > toCx;
    if (responseBelow && isLeftward) {
      msgLabelBelowByRow[row] = Math.max(msgLabelBelowByRow[row] || 0, labelH);
    } else {
      msgLabelAboveByRow[row] = Math.max(msgLabelAboveByRow[row] || 0, labelH);
    }

    if (msg.from === msg.to) {
      selfRefDropByRow[row] = selfRefDrop;
    }
    if (msg.delay) {
      timedDropByRow[row] = Math.max(timedDropByRow[row] || 0, msg.delay * delayScale);
    }
  }

  // Build sets of rows that are fragment boundaries (start, else, end).
  // These are now placeholder rows with no content.
  const fragmentStartRows = new Set<number>();
  const fragmentElseRows = new Set<number>();
  const fragmentEndRows = new Set<number>();
  // For ref fragments, the body label text must also contribute to row height
  // because ref content rows are not separate model rows.
  const refContentHeightByRow: Record<number, number> = {};
  for (const f of (model.fragments || [])) {
    fragmentStartRows.add(f.startRow);
    // endRow is exclusive; the end placeholder row is endRow - 1
    const endPlaceholder = (f.endRow ?? f.startRow + 2) - 1;
    fragmentEndRows.add(endPlaceholder);
    for (const sec of (f.sections || [])) {
      fragmentElseRows.add(sec.startRow);
    }
    // Ref fragments: compute body content height from label text
    if (f.type === 'ref' && f.label) {
      const labelH = TextBlock.inline(f.label, seqFont).height;
      const refH = tabHeight + labelH + theme.padS; // tab + body text + bottom padding
      refContentHeightByRow[f.startRow] = Math.max(refContentHeightByRow[f.startRow] || 0, refH);
    }
  }

  const fragmentBottomPad = theme.padS;  // internal padding below last content to frame bottom line

  // Unified row layout: compute centerline Y and unit height for each row.
  // The arrow sits at the centerline. Each row's bounding box is computed from
  // actual content: label height above the arrow, note height expanding both
  // above and below. The gap between adjacent bounding boxes is fixed (unitGap),
  // so rows with less content take less space, keeping visual spacing uniform.
  const arrowPad = theme.padXS;

  // Compute per-row unit dimensions using above/below center approach
  const rowUnits = [];
  for (let r = 0; r < totalRows; r++) {
    const noteH = noteHeightByRow[r] || 0;
    const labelAbove = msgLabelAboveByRow[r] || 0;
    const labelBelow = msgLabelBelowByRow[r] || 0;
    const hasMsg = msgLabelHeightByRow.hasOwnProperty(r);
    const selfDrop = selfRefDropByRow[r] || 0;
    const timedDrop = timedDropByRow[r] || 0;

    // Above center: label height above arrow (or arrowPad if no label), or noteH/2
    // Below center: label height below arrow, arrowPad, noteH/2, self-ref drop, timed delay
    let above = arrowPad;
    let below = arrowPad;

    if (labelAbove > 0) {
      above = Math.max(above, labelAbove);
    }
    if (labelBelow > 0) {
      below = Math.max(below, labelBelow);
    }
    if (noteH > 0) {
      above = Math.max(above, noteH / 2);
      below = Math.max(below, noteH / 2);
    }
    if (selfDrop > 0) {
      below = Math.max(below, selfDrop);
    }
    if (timedDrop > 0) {
      below = Math.max(below, timedDrop);
    }
    if (!hasMsg && noteH === 0) {
      // Check if this row is a fragment boundary placeholder
      if (fragmentStartRows.has(r) || fragmentElseRows.has(r)) {
        // Tab/separator placeholder: use tab height, or ref content height if larger
        above = tabHeight;
        below = 0;
        if (refContentHeightByRow[r]) {
          above = refContentHeightByRow[r];
        }
      } else if (fragmentEndRows.has(r)) {
        // End border placeholder: just a line, minimal height
        above = 0;
        below = 0;
      } else {
        // Check if this row is a hidden divider (ellipsis only; delay with text is visible)
        const isHiddenDivider = (model.dividers || []).some(
          d => (d.row ?? 0) === r && d.type === 'ellipsis'
        );
        if (isHiddenDivider) {
          // Hidden dividers add no own height — surrounding unitGap provides 2x normal gap
          above = 0;
          below = 0;
        } else if (dividerHalfHeightByRow[r]) {
          // Visible divider (section/delay): use measured content height
          above = dividerHalfHeightByRow[r];
          below = dividerHalfHeightByRow[r];
        }
      }
    }

    rowUnits.push({ height: above + below, centerOffset: above });
  }

  // Compute cumulative Y positions: each row's centerline Y
  const rowCenterYs = [];
  const rowTopYs = [];
  {
    let y = rowTop;
    for (let r = 0; r < totalRows; r++) {
      const unit = rowUnits[r];
      rowTopYs.push(y);
      rowCenterYs.push(y + unit.centerOffset);
      y += unit.height + unitGap;
    }
  }

  // Helper: map a row index to its centerline Y (where the arrow sits)
  const rowY = (row) => rowCenterYs[row] ?? rowTop;
  // Bottom edge of the last row's unit (or minimal lifeline if no rows)
  const lifelineMinHeight = theme.sizeL;
  const lastRowBottom = totalRows > 0
    ? rowTopYs[totalRows - 1] + rowUnits[totalRows - 1].height
    : rowTop + lifelineMinHeight;

  // Second pass: build participant objects with proper height
  const participants = {};
  pList.forEach((p, idx) => {
    const gw = participantSizes[idx].geomWidth;
    const centerX = centerXs[idx];
    const x = centerX - gw / 2;
    const iconH = iconHeights[idx];

    // Created participants (** decor): header appears at the create message row
    const isCreated = p.createdAtRow != null;
    // Destroyed participants (!! decor): X marker at the destroy row
    const isDestroyed = p.destroyedAtRow != null;

    let y: number;
    if (isCreated) {
      // Position header so that center aligns with the create message row Y
      y = rowY(p.createdAtRow) - iconH / 2;
    } else {
      y = marginTop + (maxIconHeight - iconH);
    }

    // Lifeline always extends to the bottom — destroy only places an X marker
    const lifelineEnd = totalRows > 0 ? lastRowBottom + unitGap : y + iconH + lifelineMinHeight;
    const height = lifelineEnd - y;

    // Destroy Y: where the X marker is placed on the lifeline.
    // For self-loop messages (from === to), the arrival point is at rowY + selfRefDrop.
    const destroyY = (() => {
      if (!isDestroyed) return undefined;
      const baseY = rowY(p.destroyedAtRow);
      const isSelfDestroy = model.messages.some(m => m.row === p.destroyedAtRow && m.from === p.id && m.to === p.id);
      return isSelfDestroy ? baseY + selfRefDrop : baseY;
    })();

    participants[p.id] = {
      id: p.id,
      x,
      y,
      width: gw,
      height,
      iconHeight: iconH,
      centerX,
      isCreated,
      createdAtRow: p.createdAtRow,
      isDestroyed,
      destroyY,
    };
  });

  // Compute boundary positions for external endpoints ([-> / ->] / ?-> / ->?)

  // Default right boundary (before label adjustment)
  const rightBoundaryDefault = (() => {
    if (pList.length === 0) return marginX + titleMinWidth;
    const lastIdx = pList.length - 1;
    return centerXs[lastIdx] + participantSizes[lastIdx].visualWidth / 2 + extBoundaryGap;
  })();

  // Pre-scan right-boundary external messages to determine if rightBoundaryX needs expanding
  let maxRightBoundaryExtend = 0;
  for (const msg of model.messages) {
    const token = msg.arrowStyle?.token || '';
    const isBoundary = token.includes('[') || token.includes(']');
    const isRightExt = msg.from === '__external_right__' || msg.to === '__external_right__';
    if (!isBoundary || !isRightExt) continue;

    const rawLabel = (msg.numberPrefix || '') + (msg.label || '');
    const labelW = rawLabel ? measureHtmlWidth(rawLabel) + extLabelPadding : 0;
    if (labelW <= 0) continue;

    const realId = msg.from === '__external_right__' ? msg.to : msg.from;
    const realIdx = pIndex[realId];
    if (realIdx === undefined) continue;
    const cx = centerXs[realIdx];
    const needed = labelW - (rightBoundaryDefault - cx);
    if (needed > 0) maxRightBoundaryExtend = Math.max(maxRightBoundaryExtend, needed);
  }

  const leftBoundaryX = 0;
  const rightBoundaryX = rightBoundaryDefault + maxRightBoundaryExtend;

  // Pre-compute activation positions for message endpoint adjustment
  // (actBarWidth and smallPad declared earlier for gap calculation)
  // Compute nesting depth for each activation (same participant, overlapping ranges stack)
  const sortedActivations = (model.activations || []).map((a, idx) => ({ ...a, idx }));
  sortedActivations.sort((a, b) => a.startRow - b.startRow || b.endRow - a.endRow);
  const nestingDepth = new Map<number, number>();
  for (let i = 0; i < sortedActivations.length; i++) {
    const a = sortedActivations[i];
    let depth = 0;
    for (let j = 0; j < i; j++) {
      const b = sortedActivations[j];
      if (b.participant === a.participant && b.startRow <= a.startRow && b.endRow >= a.endRow) {
        depth++;
      }
    }
    nestingDepth.set(a.idx, depth);
  }
  // Pre-compute activation x positions
  const activationPos = (model.activations || []).map((a, idx) => {
    const participant = participants[a.participant];
    if (!participant) return null;
    const depth = nestingDepth.get(idx) || 0;
    const x = participant.centerX - actBarWidth / 2 + depth * smallPad;
    return { id: `act${idx + 1}`, participant: a.participant, startRow: a.startRow, endRow: a.endRow, x, width: actBarWidth, depth };
  }).filter(Boolean);
  // Find the active activation for a participant at a given row.
  // endRow is exclusive: an activation with endRow===row is no longer active at that row.
  // shallow=false (default): return innermost (deepest) — for message source
  // shallow=true: return outermost (shallowest) — for message target (surface)
  function getActiveActivation(participantId: string, row: number, shallow = false) {
    let best: (typeof activationPos)[number] | null = null;
    for (const act of activationPos) {
      if (act && act.participant === participantId && act.startRow <= row && act.endRow > row) {
        if (!best || (shallow ? act.depth < best.depth : act.depth > best.depth)) {
          best = act;
        }
      }
    }
    return best;
  }

  // Find the deepest activation that starts exactly at the given row (message creates it).
  function findActivationStartingAt(participantId: string, row: number) {
    let best: (typeof activationPos)[number] | null = null;
    for (const act of activationPos) {
      if (act && act.participant === participantId && act.startRow === row) {
        if (!best || act.depth > best.depth) {
          best = act;
        }
      }
    }
    return best;
  }

  const messages = model.messages.map((msg, idx) => {
    const fromP = participants[msg.from];
    const toP = participants[msg.to];
    const y = rowY(msg.row ?? idx);
    const delay = (msg.delay || 0) * delayScale;

    if (!fromP || !toP) {
      // External endpoint: compute position based on arrow type
      const token = msg.arrowStyle?.token || '';
      const isBoundary = token.includes('[') || token.includes(']');

      // Compute label-aware short arrow length per message
      const rawLabel = (msg.numberPrefix || '') + (msg.label || '');
      const labelW = rawLabel ? measureHtmlWidth(rawLabel) + extLabelPadding : 0;
      const shortArrowLen = Math.max(minShortArrowLen, labelW);

      let fromX = 0, toX = 0;

      let sourceActId: string | undefined;
      let targetActId: string | undefined;
      if (fromP && !toP) {
        // from is a real participant, to is external
        fromX = fromP.centerX;
        const msgRow = msg.row ?? idx;
        const fromAct = getActiveActivation(msg.from, msgRow);
        if (fromAct) {
          sourceActId = fromAct.id;
          fromX = msg.to === '__external_left__' ? fromAct.x : fromAct.x + fromAct.width;
        }
        if (isBoundary) {
          toX = msg.to === '__external_left__' ? leftBoundaryX : rightBoundaryX;
        } else {
          // Short arrow: extend shortArrowLen from source
          toX = msg.to === '__external_left__'
            ? fromX - shortArrowLen
            : fromX + shortArrowLen;
        }
      } else if (!fromP && toP) {
        // to is a real participant, from is external
        toX = toP.centerX;
        const msgRow = msg.row ?? idx;
        // External messages always target the outermost (shallowest) activation surface
        const toAct = getActiveActivation(msg.to, msgRow, true);
        if (toAct) {
          targetActId = toAct.id;
          toX = msg.from === '__external_left__' ? toAct.x : toAct.x + toAct.width;
        }
        if (isBoundary) {
          fromX = msg.from === '__external_left__' ? leftBoundaryX : rightBoundaryX;
        } else {
          // Short arrow: extend shortArrowLen towards target
          fromX = msg.from === '__external_left__'
            ? toX - shortArrowLen
            : toX + shortArrowLen;
        }
      }

      // Compute relative Y for the real participant end (needed for lifeline binding)
      const fromRelY = fromP
        ? Math.max(0, Math.min(1, (y - fromP.y) / Math.max(fromP.height, 1)))
        : 0.5;
      const toRelY = toP
        ? Math.max(0, Math.min(1, ((y + delay) - toP.y) / Math.max(toP.height, 1)))
        : 0.5;

      return {
        id: `m${idx + 1}`,
        from: msg.from,
        to: msg.to,
        y,
        toY: y + delay,
        label: msg.label,
        numberPrefix: msg.numberPrefix,
        arrowStyle: msg.arrowStyle,
        self: false,
        fromX,
        toX,
        fromRelY,
        toRelY,
        waypoints: [],
        sourceActId,
        targetActId,
      };
    }

    const self = msg.from === msg.to;
    const msgRow = msg.row ?? idx;
    let fromX = fromP.centerX;
    let toX = toP.centerX;
    let sourceActId: string | undefined;
    let targetActId: string | undefined;
    let isCreate = false;
    if (!self) {
      // Create message: arrow points to target participant header box edge
      // Triggered by either ** decor on the message or 'create' statement (pendingCreate)
      if (toP.isCreated && toP.createdAtRow === msgRow) {
        isCreate = true;
        const goingRight = fromP.centerX < toP.centerX;
        // Source: still use activation bar edge if active
        const fromAct = getActiveActivation(msg.from, msgRow);
        if (fromAct) {
          sourceActId = fromAct.id;
          fromX = goingRight ? fromAct.x + fromAct.width : fromAct.x;
        }
        // Target: point to the near edge of the participant header box
        toX = goingRight ? toP.x : toP.x + toP.width;
      } else {
        // Adjust endpoints to activation bar edges when participant is activated
        const goingRight = fromP.centerX < toP.centerX;
        const fromAct = getActiveActivation(msg.from, msgRow);
        // Target: if an activation starts at this row (message triggers it), use the
        // deepest (newly created) layer; otherwise pick by direction:
        //   goingRight → arrow arrives on target's LEFT side → use shallowest (leftmost edge)
        //   !goingRight → arrow arrives on target's RIGHT side → use deepest (rightmost edge)
        const toActNew = findActivationStartingAt(msg.to, msgRow);
        const toAct = toActNew || getActiveActivation(msg.to, msgRow, goingRight);
        if (fromAct) {
          sourceActId = fromAct.id;
          fromX = goingRight ? fromAct.x + fromAct.width : fromAct.x;
        }
        if (toAct) {
          targetActId = toAct.id;
          toX = goingRight ? toAct.x : toAct.x + toAct.width;
        }
      }
    } else {
      // Self-reference: detect creating vs return direction.
      // Creating self-ref (new activation at this row): outer → inner
      // Return self-ref (deactivating): inner → outer
      const fromAct = getActiveActivation(msg.from, msgRow);
      if (fromAct && fromAct.depth > 0) {
        // Check if the deepest activation starts at this row (creating self-ref)
        const isCreating = fromAct.startRow === msgRow;
        // Find the outer activation (one depth level less)
        let outer: (typeof activationPos)[number] | null = null;
        for (const act of activationPos) {
          if (act && act.participant === msg.from && act.startRow <= msgRow && act.endRow > msgRow
              && act.depth < fromAct.depth && (!outer || act.depth > outer.depth)) {
            outer = act;
          }
        }
        if (outer) {
          const dir = msg.arrowStyle?.direction || 'right';
          const isReturning = fromAct.endRow - 1 === msgRow;
          if (isCreating) {
            // Creating self-ref: from outer layer edge, to inner layer edge
            sourceActId = outer.id;
            targetActId = fromAct.id;
            fromX = dir === 'left' ? outer.x : outer.x + outer.width;
            toX = dir === 'left' ? fromAct.x : fromAct.x + fromAct.width;
          } else if (isReturning) {
            // Return self-ref: from inner layer edge, to outer layer edge
            sourceActId = fromAct.id;
            targetActId = outer.id;
            fromX = dir === 'left' ? fromAct.x : fromAct.x + fromAct.width;
            toX = dir === 'left' ? outer.x : outer.x + outer.width;
          } else {
            // Normal self-loop within deepest activation: both endpoints on inner bar
            sourceActId = fromAct.id;
            targetActId = fromAct.id;
            fromX = dir === 'left' ? fromAct.x : fromAct.x + fromAct.width;
            toX = fromX;
          }
        }
      } else if (fromAct) {
        // Single-depth self-ref: three sub-cases based on activation lifecycle
        const dir = msg.arrowStyle?.direction || 'right';
        const isCreating = fromAct.startRow === msgRow;
        const isReturning = fromAct.endRow - 1 === msgRow;

        if (isCreating) {
          // Creating: message creates the activation — source from lifeline center,
          // target to the activation bar that was just created
          sourceActId = undefined;
          targetActId = fromAct.id;
          fromX = fromP.centerX;
          toX = dir === 'left' ? fromAct.x : fromAct.x + fromAct.width;
        } else if (isReturning) {
          // Returning: message ends the activation — source from activation bar,
          // target back to lifeline center
          sourceActId = fromAct.id;
          targetActId = undefined;
          fromX = dir === 'left' ? fromAct.x : fromAct.x + fromAct.width;
          toX = fromP.centerX;
        } else {
          // Normal loop within the activation
          sourceActId = fromAct.id;
          targetActId = fromAct.id;
          fromX = dir === 'left' ? fromAct.x : fromAct.x + fromAct.width;
          toX = fromX;
        }
      }
    }
    const fromRelY = Math.max(0, Math.min(1, (y - fromP.y) / Math.max(fromP.height, 1)));
    const toRelY = Math.max(0, Math.min(1, ((y + delay) - toP.y) / Math.max(toP.height, 1)));

    const waypoints = [];
    if (self) {
      // Determine self-reference direction: left arrows loop on the left side
      const dir = msg.arrowStyle?.direction || 'right';
      const offset = dir === 'left' ? -selfRefLoopOffset : selfRefLoopOffset;
      waypoints.push({ x: fromX + offset, y });
      waypoints.push({ x: fromX + offset, y: y + selfRefDrop });
    }

    return {
      id: `m${idx + 1}`,
      from: msg.from,
      to: msg.to,
      y,
      toY: self ? y + selfRefDrop : y + delay,
      label: msg.label,
      numberPrefix: msg.numberPrefix,
      arrowStyle: msg.arrowStyle,
      self,
      fromX,
      toX,
      fromRelY,
      toRelY,
      waypoints,
      sourceActId,
      targetActId,
      isCreate,
    };
  });

  // Build a set of rows that contain self-reference messages
  // (nested activations triggered by self-ref should start at the loop's bottom)
  const selfRefRows = new Set<number>();
  for (const msg of model.messages) {
    if (msg.from === msg.to) selfRefRows.add(msg.row);
  }

  // Build final activation layout objects (uses pre-computed nesting depth and positions)
  const activations = (model.activations || []).map((a, idx) => {
    const participant = participants[a.participant];
    if (!participant) return null;
    const depth = nestingDepth.get(idx) || 0;
    const x = participant.centerX - actBarWidth / 2 + depth * smallPad;
    // When an activation starts at a self-reference row (creating self-ref),
    // offset its start Y to the bottom of the self-ref loop (rowY + selfRefDrop).
    let y = rowY(a.startRow);
    if (selfRefRows.has(a.startRow)) {
      y = rowY(a.startRow) + selfRefDrop;
    }
    // For timed/slanted messages: if the participant is the target,
    // the activation starts at the arrow's arrival Y (rowY + delay).
    for (const msg of model.messages) {
      if (msg.row === a.startRow && msg.to === a.participant && msg.delay) {
        y = rowY(a.startRow) + msg.delay * delayScale;
        break;
      }
    }
    // endRow points to the deactivate/destroy row; the activation bar should
    // visually end at the last connected message row (endRow - 1).
    const bottomRow = Math.max(a.startRow, a.endRow - 1);
    const height = Math.max(theme.sizeXS, rowY(bottomRow) - y);
    return {
      id: `act${idx + 1}`,
      participant: a.participant,
      x,
      y,
      width: actBarWidth,
      height,
      color: a.color,
      destroyed: a.destroyed,
      depth,
    };
  }).filter(Boolean);

  const left = model.participants.length > 0 ? participants[model.participants[0].id].x : marginX;
  const lastP = model.participants.length > 0
    ? participants[model.participants[model.participants.length - 1].id]
    : null;
  const lastVW = lastP ? participantSizes[model.participants.length - 1].visualWidth : 0;
  const right = lastP ? lastP.centerX + lastVW / 2 : marginX + titleMinWidth;

  // Compute nesting depth for each fragment (outermost = 0)
  const modelFragments = model.fragments || [];
  const fragmentNestingDepth = modelFragments.map((f, i) => {
    let depth = 0;
    for (let j = 0; j < modelFragments.length; j++) {
      if (i === j) continue;
      const outer = modelFragments[j];
      if (outer.startRow <= f.startRow && (outer.endRow ?? Infinity) >= (f.endRow ?? 0)) {
        depth++;
      }
    }
    return depth;
  });
  const nestingIndent = minGap; // px per nesting level
  // Fragment top Y: place it above the start row's content area
  // The start row now has extra `fragmentBorderPad` in its `above` part,
  // so we position the frame top at rowTopY - a small margin.
  // Compute per-fragment participant range based on messages/notes within its row range

  const fragmentNoteMargin = minGap; // margin from note edge to frame border
  const fragmentParticipantRange = modelFragments.map((f) => {
    const startRow = f.startRow;
    const endRow = f.endRow ?? f.startRow + 1;
    let minIdx = Infinity;
    let maxIdx = -Infinity;

    // Scan messages in the fragment's row range
    for (const msg of model.messages) {
      const r = msg.row ?? 0;
      if (r >= startRow && r < endRow) {
        const fi = pIndex[msg.from];
        const ti = pIndex[msg.to];
        if (fi !== undefined) { minIdx = Math.min(minIdx, fi); maxIdx = Math.max(maxIdx, fi); }
        if (ti !== undefined) { minIdx = Math.min(minIdx, ti); maxIdx = Math.max(maxIdx, ti); }
      }
    }

    // Scan notes in the fragment's row range
    for (const note of model.notes || []) {
      const r = note.row ?? 0;
      if (r >= startRow && r < endRow) {
        for (const pid of note.participants || []) {
          const pi = pIndex[pid];
          if (pi !== undefined) { minIdx = Math.min(minIdx, pi); maxIdx = Math.max(maxIdx, pi); }
        }
      }
    }

    // Fallback: if no messages/notes found, use the fragment's explicit participants list,
    // or the full range if that is also absent.
    if (minIdx > maxIdx) {
      if (f.participants && f.participants.length > 0) {
        for (const pid of f.participants) {
          const pi = pIndex[pid];
          if (pi !== undefined) { minIdx = Math.min(minIdx, pi); maxIdx = Math.max(maxIdx, pi); }
        }
      }
      if (minIdx > maxIdx) {
        minIdx = 0;
        maxIdx = pList.length - 1;
      }
    }

    return { minIdx, maxIdx };
  });

  // Ensure parent fragments are at least nestingIndent wider than children on each side
  // Process from innermost to outermost (higher depth first)
  const fragOrder = modelFragments.map((_, idx) => idx);
  fragOrder.sort((a, b) => fragmentNestingDepth[b] - fragmentNestingDepth[a]);

  // First compute raw pixel bounds for each fragment (including note bounds)
  const fragmentBounds = modelFragments.map((f, idx) => {
    const range = fragmentParticipantRange[idx];
    const lifelinePad = minGap; // px from lifeline center to frame edge (for non-ref)
    // ref frames: align to participant header box edges (geomWidth/2) with no extra margin;
    // other frames: center ± lifelinePad (container padding from lifeline center).
    let rawLeft: number, rawRight: number;
    if (f.type === 'ref') {
      rawLeft = centerXs[range.minIdx] - participantSizes[range.minIdx].geomWidth / 2;
      rawRight = centerXs[range.maxIdx] + participantSizes[range.maxIdx].geomWidth / 2;
    } else {
      rawLeft = centerXs[range.minIdx] - lifelinePad;
      rawRight = centerXs[range.maxIdx] + lifelinePad;
    }

    const startRow = f.startRow;
    const endRow = f.endRow ?? f.startRow + 1;
    const labelPad = smallPad;

    // Rule 5: all messages in [startRow, endRow) contribute to bounds.
    // Self-loops: arm extends to waypoint; label starts at source point.
    // Regular messages: arrow spans fromX..toX; label is near the source end.
    for (let mIdx = 0; mIdx < messages.length; mIdx++) {
      const lm = messages[mIdx];
      const row = model.messages[mIdx].row ?? 0;
      if (row < startRow || row >= endRow) continue;
      const rawMsgLabel = model.messages[mIdx].numberPrefix
        ? (model.messages[mIdx].label ? model.messages[mIdx].numberPrefix + ' ' + model.messages[mIdx].label : model.messages[mIdx].numberPrefix)
        : (model.messages[mIdx].label || '');
      const msgLabelW = measureHtmlWidth(rawMsgLabel);
      if (lm.self && lm.waypoints && lm.waypoints.length > 0) {
        const dir = model.messages[mIdx].arrowStyle?.direction || 'right';
        const wpX = lm.waypoints[0].x;
        if (dir === 'right') {
          rawRight = Math.max(rawRight, wpX + lifelinePad);
          rawRight = Math.max(rawRight, lm.fromX + labelPad + msgLabelW + smallPad);
        } else {
          rawLeft = Math.min(rawLeft, wpX - lifelinePad);
          rawLeft = Math.min(rawLeft, lm.fromX - labelPad - msgLabelW - smallPad);
        }
      } else if (lm.fromX !== undefined && lm.toX !== undefined) {
        const msgFrom = model.messages[mIdx].from;
        const msgTo = model.messages[mIdx].to;
        const fromIsExt = msgFrom === '__external_left__' || msgFrom === '__external_right__';
        const toIsExt = msgTo === '__external_left__' || msgTo === '__external_right__';
        // Skip external endpoints — they reach the diagram boundary and must not
        // expand the fragment bounds beyond the real participants involved.
        const effectiveLeft = fromIsExt ? lm.toX : (toIsExt ? lm.fromX : Math.min(lm.fromX, lm.toX));
        const effectiveRight = fromIsExt ? lm.toX : (toIsExt ? lm.fromX : Math.max(lm.fromX, lm.toX));
        rawLeft = Math.min(rawLeft, effectiveLeft);
        rawRight = Math.max(rawRight, effectiveRight);
        // Label: anchor at the real-participant end for external messages
        const isLeftward = lm.toX < lm.fromX;
        const labelAnchorX = fromIsExt ? lm.toX : (toIsExt ? lm.fromX : (isLeftward ? lm.fromX : lm.fromX));
        if (fromIsExt) {
          // incoming from left: label is right of toX
          rawRight = Math.max(rawRight, lm.toX + labelPad + msgLabelW + smallPad);
        } else if (toIsExt) {
          // outgoing to right: label to right of fromX
          rawRight = Math.max(rawRight, lm.fromX + labelPad + msgLabelW + smallPad);
        } else if (isLeftward) {
          rawLeft = Math.min(rawLeft, labelAnchorX - labelPad - msgLabelW - smallPad);
        } else {
          rawRight = Math.max(rawRight, labelAnchorX + labelPad + msgLabelW + smallPad);
        }
      }
    }

    // Rule 5: activation bars that START within [startRow, endRow) contribute to bounds.
    // Bars that started before the fragment and "pass through" it don't expand the frame —
    // the frame is defined by its own content, not by activations inherited from outside.
    for (let aIdx = 0; aIdx < (model.activations || []).length; aIdx++) {
      const ma = model.activations[aIdx];
      const la = activations[aIdx];
      if (!la) continue;
      if (ma.startRow < startRow || ma.startRow >= endRow) continue;
      rawLeft = Math.min(rawLeft, la.x);
      rawRight = Math.max(rawRight, la.x + la.width);
    }

    // Rule 5: notes in [startRow, endRow) contribute to bounds.
    (model.notes || []).forEach((n, nIdx) => {
      const r = n.row ?? 0;
      if (r < startRow || r >= endRow) return;
      const p1 = n.participants?.[0] ? participants[n.participants[0]] : null;
      if (!p1) return;
      const noteW = noteContentSizes[nIdx].width;
      let noteLeft: number, noteRight: number;
      if (n.position === 'left') {
        noteLeft = p1.centerX - smallPad - noteW;
        noteRight = p1.centerX;
      } else if (n.position === 'right') {
        noteLeft = p1.centerX;
        noteRight = p1.centerX + smallPad + noteW;
      } else if (n.position === 'over') {
        const p2 = n.participants?.[1] ? participants[n.participants[1]] : null;
        if (p2) {
          const midX = (p1.centerX + p2.centerX) / 2;
          noteLeft = midX - noteW / 2;
          noteRight = midX + noteW / 2;
        } else {
          noteLeft = p1.centerX - noteW / 2;
          noteRight = p1.centerX + noteW / 2;
        }
      } else {
        return;
      }
      rawLeft = Math.min(rawLeft, noteLeft - fragmentNoteMargin);
      rawRight = Math.max(rawRight, noteRight + fragmentNoteMargin);
    });

    // Created participants whose header box first appears inside this fragment
    // (e.g. 'create participant X' inside a break/opt) must be fully contained,
    // with the same container-level padding (lifelinePad) as regular participants.
    for (const mp of model.participants) {
      if (mp.createdAtRow == null) continue;
      if (mp.createdAtRow < startRow || mp.createdAtRow >= endRow) continue;
      const pData = participants[mp.id];
      if (!pData) continue;
      rawLeft = Math.min(rawLeft, pData.x - lifelinePad);
      rawRight = Math.max(rawRight, pData.x + pData.width + lifelinePad);
    }

    // For ref frames, the label content determines the minimum width.
    // Center the label over the participant span, then expand bounds as needed.
    if (f.type === 'ref' && f.label) {
      const refLabelW = Math.max(...f.label.split('\n').map((l: string) => measureHtmlWidth(l))) + smallPad * 2;
      const refCenterX = (centerXs[range.minIdx] + centerXs[range.maxIdx]) / 2;
      rawLeft = Math.min(rawLeft, refCenterX - refLabelW / 2);
      rawRight = Math.max(rawRight, refCenterX + refLabelW / 2);
    }

    return { left: rawLeft, right: rawRight };
  });

  // Expand parent bounds to be at least nestingIndent wider than each child
  for (const idx of fragOrder) {
    const parent = modelFragments[idx];
    for (let j = 0; j < modelFragments.length; j++) {
      if (idx === j) continue;
      const child = modelFragments[j];
      if (parent.startRow <= child.startRow && (parent.endRow ?? Infinity) >= (child.endRow ?? 0)) {
        fragmentBounds[idx].left = Math.min(fragmentBounds[idx].left, fragmentBounds[j].left - nestingIndent);
        fragmentBounds[idx].right = Math.max(fragmentBounds[idx].right, fragmentBounds[j].right + nestingIndent);
      }
    }
  }

  // Expand only the innermost fragment enclosing each divider so the frame
  // visually contains the full divider line extent (x1/x2). Done after
  // parent-child so depth ordering is stable; then re-propagate to parents.
  for (const d of (model.dividers || [])) {
    const dRow = d.row ?? 0;
    let innermostIdx = -1;
    let innermostDepth = -1;
    for (let fIdx = 0; fIdx < modelFragments.length; fIdx++) {
      const mf = modelFragments[fIdx];
      const fragEndRow = mf.endRow ?? (mf.startRow + 1);
      if (dRow >= mf.startRow && dRow < fragEndRow) {
        const depth = fragmentNestingDepth[fIdx] ?? 0;
        if (depth > innermostDepth) { innermostDepth = depth; innermostIdx = fIdx; }
      }
    }
    if (innermostIdx >= 0) {
      const dType = d.type || 'section';
      if (dType === 'delay') {
        // delay: only a text label, no lines — expand to label text bounds only
        const dLabelW = measureHtmlWidth(d.label || '') + titlePadX * 2;
        const dCenterX = (left + right) / 2;
        const dLabelX = dCenterX - dLabelW / 2;
        fragmentBounds[innermostIdx].left = Math.min(fragmentBounds[innermostIdx].left, dLabelX);
        fragmentBounds[innermostIdx].right = Math.max(fragmentBounds[innermostIdx].right, dLabelX + dLabelW);
      } else {
        // section / other: has full-width lines, expand to full diagram extent
        fragmentBounds[innermostIdx].left = Math.min(fragmentBounds[innermostIdx].left, left - minGap);
        fragmentBounds[innermostIdx].right = Math.max(fragmentBounds[innermostIdx].right, right + minGap);
      }
    }
  }

  // Re-propagate after divider expansion so parent fragments still contain children.
  for (const idx of fragOrder) {
    const parent = modelFragments[idx];
    for (let j = 0; j < modelFragments.length; j++) {
      if (idx === j) continue;
      const child = modelFragments[j];
      if (parent.startRow <= child.startRow && (parent.endRow ?? Infinity) >= (child.endRow ?? 0)) {
        fragmentBounds[idx].left = Math.min(fragmentBounds[idx].left, fragmentBounds[j].left - nestingIndent);
        fragmentBounds[idx].right = Math.max(fragmentBounds[idx].right, fragmentBounds[j].right + nestingIndent);
      }
    }
  }

  // Re-check condition label right bound using the final (post-divider) left edge.
  // Divider expansion may have pushed frame.left further left than naturalLeft, which
  // would otherwise leave extra whitespace on the right side.
  // ref type is skipped: its label is body content, not a tab condition.
  for (let idx = 0; idx < modelFragments.length; idx++) {
    const f = modelFragments[idx];
    if (f.type === 'ref') continue;
    const isGroupLike2 = f.type === 'group' || f.type === 'partition';
    const tabLabel2 = isGroupLike2 ? (f.label || '').replace(/\s*\[.*\]\s*$/, '').trim() : f.type;
    const tabTextW2 = TextBlock.inline(tabLabel2 || f.type, { ...seqFont, weight: 'bold' }).width;
    const tabWidth2 = Math.max(Math.ceil(tabTextW2) + fontSize, theme.sizeL);
    const condLabel2 = isGroupLike2
      ? ((f.label || '').match(/\[([^\]]*)\]/)?.[1] || '')
      : (f.label || '');
    if (condLabel2) {
      const condW2 = measureHtmlWidth(condLabel2) + smallPad * 2;
      const minRight2 = fragmentBounds[idx].left + tabWidth2 + smallPad + condW2 + smallPad;
      fragmentBounds[idx].right = Math.max(fragmentBounds[idx].right, minRight2);
    }
  }

  // Re-propagate after condLabel expansion so parent fragments still contain children.
  for (const idx of fragOrder) {
    const parent = modelFragments[idx];
    for (let j = 0; j < modelFragments.length; j++) {
      if (idx === j) continue;
      const child = modelFragments[j];
      if (parent.startRow <= child.startRow && (parent.endRow ?? Infinity) >= (child.endRow ?? 0)) {
        fragmentBounds[idx].left = Math.min(fragmentBounds[idx].left, fragmentBounds[j].left - nestingIndent);
        fragmentBounds[idx].right = Math.max(fragmentBounds[idx].right, fragmentBounds[j].right + nestingIndent);
      }
    }
  }

  const fragments = modelFragments.map((f, idx) => {
    const fragX = fragmentBounds[idx].left;
    const fragW = fragmentBounds[idx].right - fragmentBounds[idx].left;
    // Frame top: at the start row's top (tab occupies the above-space)
    const fragY = (rowTopYs[f.startRow] ?? rowTop);
    // Frame bottom: the end placeholder row is at endRow - 1
    const endPlaceholderRow = (f.endRow ?? f.startRow + 2) - 1;
    const fragBottom = (rowTopYs[endPlaceholderRow] ?? rowTop);
    // Minimum height: for ref type, account for body text content lines
    let minFragH = theme.sizeL;
    if (f.type === 'ref' && f.label) {
      const labelLines = f.label.split('\n').length;
      const lineH = theme.titleFontSize;
      minFragH = tabHeight + labelLines * lineH + theme.arcSize;
    }
    const fragH = Math.max(minFragH, fragBottom - fragY);
    // Tab width: based on actual tab text width + padding (aligned with FrameRenderer)
    // For group/partition, the tab shows the label text, not the keyword
    const isGroupLike = f.type === 'group' || f.type === 'partition';
    const tabLabel = isGroupLike ? (f.label || '').replace(/\s*\[.*\]\s*$/, '').trim() : f.type;
    const tabTextW = TextBlock.inline(tabLabel || f.type, { ...seqFont, weight: 'bold' }).width;
    const tabWidth = Math.max(Math.ceil(tabTextW) + fontSize, theme.sizeL);

    return {
      id: `frag${idx + 1}`,
      type: f.type,
      label: f.label,
      lineColor: f.lineColor,
      fillColor: f.fillColor,
      tabWidth,
      tabHeight,
      sections: (f.sections || []).map(sec => ({
        ...sec,
        y: (rowTopYs[sec.startRow] ?? rowTop),
      })),
      x: fragX,
      y: fragY,
      width: fragW,
      height: fragH,
    };
  });

  const allParticipantLayouts = model.participants.map(p => participants[p.id]).filter(Boolean);
  const firstPCenter = allParticipantLayouts.length > 0 ? allParticipantLayouts[0].centerX : left + (right - left) / 2;
  const lastPCenter = allParticipantLayouts.length > 0 ? allParticipantLayouts[allParticipantLayouts.length - 1].centerX : firstPCenter;

  const dividers = (model.dividers || []).map((d, idx) => {
    const row = d.row ?? 0;
    // Center between first and last participant's lifeline center (matches PlantUML's DelayTile logic)
    const divCenterX = (firstPCenter + lastPCenter) / 2;
    const labelW = measureHtmlWidth(d.label || '') + titlePadX * 2; // text width + left/right padding
    const halfHeight = dividerHalfHeightByRow[row] || smallPad;
    return {
      id: `div${idx + 1}`,
      label: d.label,
      type: d.type || 'section',
      y: rowY(d.row),
      halfHeight,
      x1: left - minGap,
      x2: right + minGap,
      labelX: divCenterX - labelW / 2,
      labelWidth: labelW,
    };
  });

  const notes = (model.notes || []).map((n, idx) => {
    const noteW0 = noteContentSizes[idx].width;
    const noteH = noteContentSizes[idx].height;
    // Center note vertically on the row's centerline
    const y = rowY(n.row) - noteH / 2;

    const p1 = n.participants && n.participants[0] ? participants[n.participants[0]] : null;
    const p2 = n.participants && n.participants[1] ? participants[n.participants[1]] : null;

    let noteW = noteW0;
    let x = left;

    // For created participants, when the note is on the same row as the header,
    // anchor to the node box edge instead of the lifeline center.
    const useNodeEdge = p1 && p1.isCreated && p1.createdAtRow === n.row;

    if (n.across) {
      // Across notes span all participants
      x = left;
      noteW = Math.max(noteW, right - left);
    } else if (n.position === 'left' && p1) {
      // Align right edge to participant anchor minus gap
      const anchor = useNodeEdge ? p1.x : p1.centerX;
      x = anchor - smallPad - noteW;
    } else if (n.position === 'right' && p1) {
      // Align left edge to participant anchor plus gap
      const anchor = useNodeEdge ? p1.x + p1.width : p1.centerX;
      x = anchor + smallPad;
    } else if (n.position === 'over' && p1 && p2) {
      // Span note from left-participant left edge to right-participant right edge
      const leftEdge = Math.min(p1.x, p2.x);
      const rightEdge = Math.max(p1.x + p1.width, p2.x + p2.width);
      const span = rightEdge - leftEdge;
      noteW = Math.max(noteW, span);
      x = (leftEdge + rightEdge) / 2 - noteW / 2;
    } else if (n.position === 'over' && p1) {
      x = p1.centerX - noteW / 2;
    }

    // Notes stay at root level to avoid z-order issues with lifelines.
    const parentId = null;

    return {
      id: `note${idx + 1}`,
      x,
      y,
      width: noteW,
      height: noteH,
      noteType: n.noteType || 'note',
      color: n.color || null,
      parentId,
    } as LayoutNote;
  });

  // Duration constraints (teoz {tag} <-> {tag})
  const durationConstraints = (model.durationConstraints || []).map((dc, idx) => {
    // Position vertical line at midpoint between the two involved participants
    const ps = (dc.participants || []).map(pid => participants[pid]).filter(Boolean);
    let x: number;
    if (ps.length >= 2) {
      const centers = ps.map(p => p.centerX);
      x = (Math.min(...centers) + Math.max(...centers)) / 2;
    } else if (ps.length === 1) {
      x = ps[0].centerX;
    } else {
      x = (left + right) / 2;
    }
    const y1 = rowY(dc.startRow);
    const y2 = rowY(dc.endRow);
    const labelW = measureHtmlWidth(dc.label || '') + theme.padS; // label width + padding
    return {
      id: `dc${idx + 1}`,
      label: dc.label,
      x,
      y1,
      y2,
      labelX: x + arrowPad,
      labelWidth: labelW,
    };
  });

  const width = right + marginX;
  // Expand width if notes or external boundary arrows extend beyond rightmost participant
  let maxRight = right;
  for (const note of notes) {
    maxRight = Math.max(maxRight, note.x + note.width);
  }
  maxRight = Math.max(maxRight, rightBoundaryX);
  // Expand width if duration constraint labels extend beyond right edge
  for (const dc of durationConstraints) {
    maxRight = Math.max(maxRight, dc.labelX + dc.labelWidth);
  }
  const finalWidth = Math.max(width, maxRight + marginX);
  const height = totalRows > 0 ? lastRowBottom + unitGap + maxIconHeight + unitGap : rowTop + lifelineMinHeight + theme.padS;

  // Center title over participant content area (left ~ right)
  if (titleLayout) {
    const contentCenter = (left + right) / 2;
    titleLayout.x = contentCenter - titleLayout.width / 2;
  }

  // Box layout: compute positions for participant group boxes

  const boxLayouts = (model.boxes || []).map((box, idx) => {
    // Find leftmost and rightmost participant in this box
    let minX = Infinity, maxX = -Infinity;
    for (const pid of box.participants) {
      const p = participants[pid];
      if (!p) continue;
      const pl = p.centerX - participantSizes[pIndex[pid]]?.visualWidth / 2;
      const pr = p.centerX + participantSizes[pIndex[pid]]?.visualWidth / 2;
      minX = Math.min(minX, pl);
      maxX = Math.max(maxX, pr);
    }
    if (minX > maxX) return null; // no valid participants
    const x = minX - smallPad;
    const w = maxX - minX + smallPad * 2;
    // Box extends from above participant headers to bottom of lifelines
    const y = marginTop - tabHeight;
    const h = height - y - smallPad; // extend to near bottom
    const boxId = `box${idx + 1}`;
    const boxRenderer = createRenderer('box', { id: boxId, label: box.label, color: box.color, fixedHeight: tabHeight, theme });
    renderers.set(boxId, boxRenderer);
    return { id: boxId, x, y, width: w, height: h };
  }).filter(Boolean);

  // Mainframe layout: wraps the entire diagram with uniform internal padding
  let mainframeLayout = undefined;
  if (model.mainframe) {
    const frameRenderer = createRenderer('frame', { id: 'mainframe', label: model.mainframe, fixedHeight: tabHeight, theme });
    renderers.set('mainframe', frameRenderer);
    const mfY = titleLayout ? titleLayout.height + smallPad : 0;
    // Compute tight content bounds for uniform padding
    const contentRight = right + minGap;
    const contentBottom = lastRowBottom + unitGap + maxIconHeight + minGap; // footbox = participant header height
    mainframeLayout = {
      x: 0,
      y: mfY,
      width: contentRight,
      height: contentBottom - mfY,
    };
  }

  return {
    width: finalWidth,
    height,
    participants,
    messages,
    activations,
    fragments,
    dividers,
    durationConstraints,
    notes,
    boxes: boxLayouts,
    mainframe: mainframeLayout,
    title: titleLayout,
    renderers,
  };
}
