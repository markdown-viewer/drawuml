/**
 * Gantt chart DrawIO XML generator.
 *
 * Converts a GanttModel with layout coordinates into a complete DrawIO mxfile XML string.
 * Renders: task labels, task bars, milestones, separators, dependency edges.
 */

import type { GanttModel, GanttTask, GanttResource } from '../model/gantt-model.ts';
import type { GanttLayoutResult } from '../layout/gantt-layout.ts';
import type { Renderer } from '../primitives/renderer.ts';
import type { Theme } from '../shared/theme.ts';
import { mxVertex, escapeXml, wrapMxfile } from '../shared/xml-utils.ts';
import { buildEdgeCells } from '../shared/edge-builder.ts';
import type { EdgeCellSpec } from '../shared/edge-builder.ts';

export function ganttToDrawioXml(
  model: GanttModel,
  layout: GanttLayoutResult,
  renderers: Map<string, Renderer>,
  theme: Theme,
): string {
  const cells: string[] = [];
  const tc = layout.timelineConfig;

  // ═══ Timeline header: grid lines + labels ═══
  const gridLineW = theme.padXXS;       // grid line width (2px)
  const timelineX = theme.padS;         // margin from layout (10px)
  const headerH = tc.headerHeight;
  const rowH = tc.rowHeight;
  // Compute resource rows (for footbox height calculation)
  const resourceNames = collectResourceNames(model);
  const resourceRowCount = model.config.hideResourcesFootbox ? 0 : resourceNames.length;
  const rowAreaH = (layout.rowCount + resourceRowCount) * rowH;
  const gridBottom = headerH + rowAreaH;

  const dayW = tc.dayWidth;
  const gMinDate = new Date(tc.minDate); gMinDate.setHours(0, 0, 0, 0);
  const gMaxDate = new Date(tc.maxDate); gMaxDate.setHours(0, 0, 0, 0);
  const totalDays = Math.ceil((gMaxDate.getTime() - gMinDate.getTime()) / 86400000);

  const hasProjectStart = !!model.projectStart;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const effectiveScale = tc.scale || 'daily';

  // Print range offset: skip days before printRange.from
  const startD = tc.printFromOff || 0;

  // Canonical day-offset → pixel-x transform (matches gantt-layout's dayToX)
  const dayToX = (d: number) => Math.round(timelineX + (d - startD) * dayW);

  // Grid line color: use defaultFill for consistency
  const gridLineFill = theme.defaultFill;

  if (effectiveScale === 'daily') {
    // ── Daily header: day numbers (counting mode) or month+day (date mode) ──
    let lastMonth = -1, monthStartDay = 0;

    for (let d = startD; d <= totalDays; d++) {
      const cur = new Date(gMinDate); cur.setDate(cur.getDate() + d);
      const x = dayToX(d);

      cells.push(mxVertex({
        id: `grid_${d}`,
        parent: '1', value: '',
        style: `shape=rect;fillColor=${gridLineFill};strokeColor=none;html=1;`,
        x: x - 1, y: Math.round(headerH / 2),
        width: gridLineW, height: gridBottom - Math.round(headerH / 2),
      }));

      if (hasProjectStart) {
        const m = cur.getMonth();
        if (m !== lastMonth) {
          if (lastMonth >= 0 && d > monthStartDay) {
            const span = (d - monthStartDay) * dayW;
            const midX = dayToX((monthStartDay + d - 1) / 2);
            cells.push(mxVertex({
              id: `mon_${monthStartDay}`, parent: '1',
              value: `${monthNames[lastMonth]} ${cur.getFullYear() - (m < lastMonth ? 1 : 0)}`,
              style: `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};fontColor=${theme.fontColor};fontStyle=1;align=center;verticalAlign=middle;`,
              x: midX - Math.round(span / 2), y: 0,
              width: Math.round(span), height: headerH / 2,
            }));
          }
          lastMonth = m;
          monthStartDay = d;
        }
      }

      const showDay = hasProjectStart ? (d < totalDays) : (d > 0);
      if (showDay) {
        const cellCenter = dayToX(hasProjectStart ? d + 0.5 : d - 0.5);
        const labelText = hasProjectStart ? String(cur.getDate()) : String(d);
        cells.push(mxVertex({
          id: `day_${d}`, parent: '1', value: labelText,
          style: `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};fontColor=${theme.fontColor};align=center;verticalAlign=middle;`,
          x: Math.round(cellCenter - theme.sizeS / 2), y: headerH / 2,
          width: theme.sizeS, height: headerH / 2,
        }));
      }
    }
    // Final month label for date mode
    if (hasProjectStart && lastMonth >= 0 && totalDays > monthStartDay) {
      const cur = new Date(gMinDate); cur.setDate(cur.getDate() + totalDays);
      const span = (totalDays - monthStartDay + 1) * dayW;
      const midX = dayToX((monthStartDay + totalDays) / 2);
      cells.push(mxVertex({
        id: `mon_${monthStartDay}`, parent: '1',
        value: `${monthNames[lastMonth]} ${cur.getFullYear()}`,
        style: `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};fontColor=${theme.fontColor};fontStyle=1;align=center;verticalAlign=middle;`,
        x: midX - Math.round(span / 2), y: 0,
        width: Math.round(span), height: headerH / 2,
      }));
    }
  } else {
    // ── Non-daily header: weekly / monthly / quarterly ──
    renderScaleHeader(cells, gMinDate, gMaxDate, dayW, timelineX, headerH, gridBottom, effectiveScale, hasProjectStart, theme, monthNames, startD, model.config.printScale?.weekNumberingFrom, model.config.printScale?.calendarDate, model.config.weekStartsOn, model.config.weekMinDays);
  }

  // Date range backgrounds — rendered BEFORE task bars so they appear behind

  // Helper: convert a date to x coordinate via dayToX
  function _dateToX(date: Date): number {
    const dayOff = Math.round((date.getTime() - gMinDate.getTime()) / 86400000);
    return dayToX(dayOff);
  }

  for (const dr of model.dateRanges) {
    const fromDate = _resolveDate(dr.from);
    let toDate = _resolveDate(dr.to);
    if (!fromDate || !toDate) continue;
    toDate = new Date(toDate.getTime() + 86400000); // +1 day (exclusive)
    const x = _dateToX(fromDate);
    const endX = _dateToX(toDate);
    const rangeW = Math.max(1, endX - x);

    cells.push(mxVertex({
      id: `dr_${Math.random().toString(36).slice(2, 8)}`,
      parent: '1',
      value: dr.name ? escapeXml(dr.name) : '',
      style: [
        `shape=rect`, `fillColor=${dr.color || theme.defaultFill}`,
        `strokeColor=none`, `opacity=50`, `html=1`,
      ].join(';') + ';',
      x: Math.round(x),
      y: tc.headerHeight,
      width: Math.round(rangeW),
      height: (layout.rowCount + resourceRowCount) * tc.rowHeight,
    }));
  }

  // Render dependency edges — rendered BEFORE task bars so they appear behind
  let edgeIndex = 0;
  for (const edge of layout.edges) {
    const edgeId = `edge_${edgeIndex++}`;
    const wp = edge.waypoints || [];
    // Look up dependency style from model
    const dep = model.dependencies.find(d => d.from === edge.fromId && d.to === edge.toId);
    const edgeColor = dep?.color || theme.colorDark;
    const dashPattern = dep?.style === 'dotted' ? '1 4' : dep?.style === 'dashed' ? '4 4' : undefined;
    const styleParts = [`edgeStyle=orthogonalEdgeStyle`, `rounded=0`, `html=1`, `strokeColor=${edgeColor}`, `strokeWidth=${theme.strokeWidth}`, `endArrow=classic`];
    if (dashPattern) styleParts.push(`dashed=1`, `dashPattern=${dashPattern}`);
    const spec: EdgeCellSpec = {
      id: edgeId, parent: '1', source: edge.fromId + '_border', target: edge.toId + '_border',
      style: styleParts.join(';') + ';',
      geometry: {
        sourcePoint: wp.length > 0 ? wp[0] : undefined,
        targetPoint: wp.length > 1 ? wp[wp.length - 1] : undefined,
        waypoints: wp.length > 2 ? wp.slice(1, -1) : undefined,
      },
      fontSize: theme.fontSize, fontFamily: theme.fontFamily,
    };
    cells.push(...buildEdgeCells(spec));
  }

  // Render task bars via renderers (labels are embedded inside bars)
  for (const task of model.tasks) {
    if (task.deleted) continue;
    const renderer = renderers.get(task.id);
    const node = layout.nodes[task.id];
    if (renderer && node) {
      cells.push(...renderer.render({
        x: node.x, y: node.y,
        width: node.width, height: node.height,
      }));
    }
    // URL is stored on task for metadata; not rendered as text (PlantUML makes bar clickable)
  }

  // Render separators (ids start with 'sep_')
  for (const [id, renderer] of renderers) {
    if (!id.startsWith('sep_')) continue;
    const node = layout.nodes[id];
    if (!node) continue;
    cells.push(...renderer.render({
      x: node.x, y: node.y,
      width: node.width, height: node.height,
    }));
  }

  // Render milestones
  for (const ms of model.milestones) {
    const renderer = renderers.get(ms.id);
    const node = layout.nodes[ms.id];
    if (renderer && node) {
      cells.push(...renderer.render({
        x: node.x, y: node.y,
        width: node.width, height: node.height,
      }));
    }
  }

  // ═══ Resource bars (footbox) ═══
  renderResourceBars(cells, model, layout, theme);

  // Weekend / closed-day background shading — rendered AFTER task bars so they overlay with semi-transparency
  const closedDayFill = theme.defaultFill;
  const closedDays = model.config.closedDays || [];
  const closedDateRanges = model.config.closedDates || [];

  // Pre-compute closed date range day-offset intervals for overlap detection
  const closedDateIntervals: { from: number; to: number }[] = [];
  for (const cd of closedDateRanges) {
    const fromD = Math.round((_resolveDate(cd.from)?.getTime()! - gMinDate.getTime()) / 86400000);
    const toD = Math.round((_resolveDate(cd.to)?.getTime()! - gMinDate.getTime()) / 86400000);
    if (isNaN(fromD) || isNaN(toD)) continue;
    closedDateIntervals.push({ from: fromD, to: toD + 1 }); // +1: inclusive→exclusive
  }
  // Apply open dates: remove open days from closed intervals, splitting if necessary
  if (model.config.openDates && model.config.openDates.length > 0) {
    for (const od of model.config.openDates) {
      const openOff = Math.round((_resolveDate(od.date)?.getTime()! - gMinDate.getTime()) / 86400000);
      if (isNaN(openOff)) continue;
      const newIntervals: { from: number; to: number }[] = [];
      for (const iv of closedDateIntervals) {
        if (openOff >= iv.from && openOff < iv.to) {
          if (openOff > iv.from) newIntervals.push({ from: iv.from, to: openOff });
          if (openOff + 1 < iv.to) newIntervals.push({ from: openOff + 1, to: iv.to });
        } else {
          newIntervals.push(iv);
        }
      }
      closedDateIntervals.length = 0;
      for (const ni of newIntervals) closedDateIntervals.push(ni);
    }
  }

  // Helper: check if a day offset is inside any closed date range
  const isInClosedDate = (d: number) => closedDateIntervals.some(r => d >= r.from && d < r.to);

  if (closedDays.length > 0) {
    for (let d = startD; d < totalDays; d++) {
      const cur = new Date(gMinDate); cur.setDate(cur.getDate() + d);
      // Skip if already covered by a closed date range (avoids double shading)
      if (closedDays.includes(cur.getDay()) && !isInClosedDate(d)) {
        const wx = dayToX(d);
        cells.push(mxVertex({
          id: `closed_${d}`, parent: '1', value: '',
          style: `shape=rect;fillColor=${closedDayFill};strokeColor=none;opacity=55;html=1;`,
          x: wx, y: tc.headerHeight,
          width: dayW, height: (layout.rowCount + resourceRowCount) * tc.rowHeight,
        }));
      }
    }
  }

  // Closed date ranges (holidays) — rendered as shaded background
  for (const iv of closedDateIntervals) {
    const cdFrom = Math.max(startD, iv.from);
    const cdTo = Math.min(totalDays, iv.to);
    if (cdTo <= cdFrom) continue;
    const wx = dayToX(cdFrom);
    const rangeW = Math.round((cdTo - cdFrom) * dayW);
    cells.push(mxVertex({
      id: `closed_range_${cdFrom}`,
      parent: '1', value: '',
      style: `shape=rect;fillColor=${closedDayFill};strokeColor=none;opacity=55;html=1;`,
      x: wx, y: tc.headerHeight,
      width: rangeW, height: (layout.rowCount + resourceRowCount) * tc.rowHeight,
    }));
  }

  // Title
  const titleH = Math.round(theme.titleBarH);  // 20 @12
  const titleGap = Math.round(theme.padXL); // 30 @12
  let topOffset = 0;
  if (model.title) {
    cells.push(mxVertex({
      id: 'gantt_title',
      parent: '1',
      value: escapeXml(model.title),
      style: [
        `shape=rect`, `fillColor=none`, `strokeColor=none`,
        `html=1`, `fontSize=${theme.fontSize + 4}`,
        `fontFamily=${theme.fontFamily}`, `fontStyle=1`,
        `align=center`, `verticalAlign=middle`,
      ].join(';') + ';',
      x: 0, y: topOffset, width: layout.width, height: titleH,
    }));
    topOffset += titleGap;
  }

  // Header / Footer / Caption — use theme.sizeS (20) for row height
  const subHeaderH = theme.sizeS;
  if (model.header) {
    cells.push(mxVertex({
      id: 'gantt_header', parent: '1', value: escapeXml(model.header),
      style: `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};align=center;`,
      x: 0, y: topOffset, width: layout.width, height: subHeaderH,
    }));
    topOffset += theme.padL;
  }

  if (model.caption) {
    cells.push(mxVertex({
      id: 'gantt_caption', parent: '1', value: escapeXml(model.caption),
      style: `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};align=center;`,
      x: 0, y: layout.height - theme.padL, width: layout.width, height: subHeaderH,
    }));
  }

  if (model.footer) {
    cells.push(mxVertex({
      id: 'gantt_footer', parent: '1', value: escapeXml(model.footer),
      style: `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};align=center;`,
      x: 0, y: layout.height - theme.padL - theme.sizeS, width: layout.width, height: subHeaderH,
    }));
  }

  // Legend table — line height and padding derived from fontSize
  const legendLineH = Math.round(theme.rowH); // 20 @12
  const legendPadH = Math.round(theme.padXL);  // 30 @12
  if (model.legend && model.legend.lines?.length) {
    const legendH = model.legend.lines.length * legendLineH + legendPadH;
    const legendY = layout.height + theme.padS;
    cells.push(mxVertex({
      id: 'gantt_legend', parent: '1', value: escapeXml(model.legend.lines.join('\n')),
      style: `shape=rect;fillColor=none;strokeColor=${theme.colorDark};html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};whiteSpace=wrap;align=left;verticalAlign=top;`,
      x: theme.padS, y: legendY, width: layout.width - 2 * theme.padL, height: legendH,
    }));
  }

  // Notes — line height and padding derived from fontSize
  const noteLineH = Math.round(theme.padL); // 20 @12
  const notePadH = Math.round(theme.padM);  // 15 @12
  const legendOffsetH = Math.round(theme.padXXL); // 40 @12
  let noteY = layout.height + resourceRowCount * rowH + theme.padS + (model.legend?.lines?.length ? model.legend.lines.length * legendLineH + legendOffsetH : 0);
  for (const note of model.notes) {
    const noteH = note.lines.length * noteLineH + notePadH;
    cells.push(mxVertex({
      id: `gantt_note_${noteY}`, parent: '1', value: escapeXml(note.lines.join('\n')),
      style: `shape=note;fillColor=${theme.noteFill};strokeColor=${theme.noteBorderColor};html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};whiteSpace=wrap;align=left;verticalAlign=top;`,
      x: theme.padS, y: noteY, width: layout.width - 2 * theme.padL, height: noteH,
    }));
    noteY += noteH + theme.padXS;
  }

  const finalH = Math.max(layout.height + resourceRowCount * rowH, noteY + theme.padL);

  return wrapMxfile(cells, {
    pageWidth: Math.max(layout.width, 850),
    pageHeight: Math.max(finalH, 1100),
  });
}

// ═══ Resource bar rendering ════════════════════════════════════════════════════

/** Collect unique resource names from all task assignments, preserving order. */
function collectResourceNames(model: GanttModel): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const t of model.tasks) {
    if (t.deleted) continue;
    for (const r of t.resources || []) {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        names.push(r.name);
      }
    }
  }
  return names;
}

/** Render resource footbox bars: name, underline, periodic load numbers. */
function renderResourceBars(
  cells: string[],
  model: GanttModel,
  layout: GanttLayoutResult,
  theme: Theme,
): void {
  // hide resources footbox suppresses the entire resource section
  if (model.config.hideResourcesFootbox) return;
  const resourceNames = collectResourceNames(model);
  if (resourceNames.length === 0) return;

  const tc = layout.timelineConfig;
  const timelineX = theme.padS;
  const headerH = tc.headerHeight;
  const rowH = tc.rowHeight;
  const dayW = tc.dayWidth;
  const startD = tc.printFromOff || 0;
  const dayToX = (d: number) => Math.round(timelineX + (d - startD) * dayW);
  const gMinDate = new Date(tc.minDate); gMinDate.setHours(0, 0, 0, 0);
  const gMaxDate = new Date(tc.maxDate); gMaxDate.setHours(0, 0, 0, 0);
  const totalDays = Math.ceil((gMaxDate.getTime() - gMinDate.getTime()) / 86400000);

  // Build resource off-day set for load calculation
  const resOffDays = buildResourceOffDays(model, gMinDate);

  const resolved = resolveModelForResource(model, gMinDate, resOffDays);
  const { effectiveScale } = getEffectiveScaleForResource(model);
  const periodDays = scaleToPeriodDays(effectiveScale);

  const font = { size: theme.fontSize - 2, family: theme.fontFamily };
  const nameFont = { size: theme.fontSize, family: theme.fontFamily, weight: 'bold' as const };

  const rowStartY = headerH + layout.rowCount * rowH;
  const nameW = theme.sizeXL; // left margin for resource names (60px)

  for (let ri = 0; ri < resourceNames.length; ri++) {
    const resName = resourceNames[ri];
    const resY = rowStartY + ri * rowH;

    // Resource name label (left-aligned, bold) — always show in footbox
    // (hideResourcesNames only affects task labels in the left column)
    cells.push(mxVertex({
      id: `res_label_${ri}`,
      parent: '1',
      value: escapeXml(resName),
      style: [
        `text`, `html=1`, `fillColor=none`, `strokeColor=none`,
        `fontSize=${nameFont.size}`, `fontFamily=${nameFont.family}`,
        `fontStyle=1`, `fontColor=${theme.fontColor}`,
        `align=left`, `verticalAlign=middle`,
      ].join(';') + ';',
      x: Math.round(timelineX),
      y: Math.round(resY),
      width: nameW,
      height: Math.round(rowH / 2),
    }));

    // Horizontal line below name
    const lineY = Math.round(resY + rowH / 2);
    cells.push(mxVertex({
      id: `res_line_${ri}`,
      parent: '1',
      value: '',
      style: `shape=rect;fillColor=${theme.colorDark};strokeColor=none;html=1;`,
      x: Math.round(timelineX),
      y: lineY,
      width: Math.round((totalDays - startD) * dayW),
      height: theme.strokeWidth,
    }));

    // Calculate load numbers for each period
    const periods = getResourcePeriods(resName, model, resolved, gMinDate, totalDays, startD, periodDays, resOffDays);
    for (const p of periods) {
      if (p.load > 0) {
        const px = dayToX(p.startDay);
        const pw = Math.round((p.endDay - p.startDay) * dayW);
        cells.push(mxVertex({
          id: `res_num_${ri}_${p.startDay}`,
          parent: '1',
          value: String(p.load),
          style: [
            `text`, `html=1`, `fillColor=none`, `strokeColor=none`,
            `fontSize=${font.size}`, `fontFamily=${font.family}`,
            `fontColor=${p.overload ? theme.ganttOverloadColor : theme.fontColor}`,
            `align=center`, `verticalAlign=middle`,
          ].join(';') + ';',
          x: px,
          y: Math.round(lineY + 2),
          width: pw,
          height: Math.round(rowH / 2 - 2),
        }));
      }
    }
  }
}

interface ResourcePeriod { startDay: number; endDay: number; load: number; overload: boolean; }

/** Get the load for each time period for a specific resource. */
function getResourcePeriods(
  resName: string,
  model: GanttModel,
  resolved: { taskDays: Record<string, { start: number; end: number }> },
  gMinDate: Date,
  totalDays: number,
  startD: number,
  periodDays: number,
  resOffDays: Map<string, number[]>,
): ResourcePeriod[] {
  const periods: ResourcePeriod[] = [];
  let pStart = startD;

  while (pStart < totalDays) {
    const pEnd = Math.min(pStart + periodDays, totalDays);
    let totalLoad = 0;
    let activeDays = 0;
    let overload = false;

    for (let d = pStart; d < pEnd; d++) {
      let dayLoad = 0;
      for (const t of model.tasks) {
        if (t.deleted) continue;
        const td = resolved.taskDays[t.id];
        if (!td) continue;
        // Only count full days within the task span: ceil(start) to floor(end)
        const taskStart = Math.ceil(td.start);
        const taskEnd = Math.floor(td.end);
        if (d < taskStart || d >= taskEnd) continue;
        for (const r of t.resources || []) {
          if (r.name !== resName) continue;
          // Skip if this resource is off on this day
          if (isResourceOffDay(r.name, d, resOffDays)) continue;
          dayLoad += r.load ?? 100;
        }
      }
      if (dayLoad > 0) {
        totalLoad += dayLoad;
        activeDays++;
        if (dayLoad > 100) overload = true;
      }
    }

    if (totalLoad > 0 && activeDays > 0) {
      // PlantUML skips the last incomplete period (don't show partial final period)
      const isLastPeriod = pEnd >= totalDays;
      const isPartial = (pEnd - pStart) < periodDays;
      if (isLastPeriod && isPartial) { pStart = pEnd; continue; }
      // Normalize load to a full period: totalLoad * periodDays / activeDays
      const normalizedLoad = Math.round(totalLoad * periodDays / activeDays);
      periods.push({ startDay: pStart, endDay: pEnd, load: normalizedLoad, overload });
    }

    pStart = pEnd;
  }

  return periods;
}

/** Minimal model resolution for resource load calculation (duplicates layout logic). */
function resolveModelForResource(
  model: GanttModel,
  minDay: Date,
  resOffDays: Map<string, number[]>,
): { taskDays: Record<string, { start: number; end: number }> } {
  const r: { taskDays: Record<string, { start: number; end: number }> } = { taskDays: {} };

  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const t of model.tasks) {
      if (t.deleted) continue;
      const prev = r.taskDays[t.id];
      let s: number | null = null;
      let e: number | null = null;

      // Resolve start
      if (t.start) {
        if (t.start.type === 'absolute') {
          s = dateOffRes(parseDateRes(t.start.date), minDay);
        } else if (t.start.type === 'offset_from_start') {
          s = t.start.days;
        } else if (t.start.type === 'relative_to_task') {
          const ref = r.taskDays[findTaskId(model, t.start.taskId)];
          if (ref) s = (t.start.anchor === 'start' ? ref.start : ref.end) + (t.start.offsetDays || 0);
        }
      }

      // Resolve end
      if (t.end) {
        if (t.end.type === 'absolute') {
          e = dateOffRes(parseDateRes(t.end.date), minDay) + 1;
        } else if (t.end.type === 'offset_from_start') {
          e = t.end.days + 1;
        } else if (t.end.type === 'relative_to_task') {
          const ref = r.taskDays[findTaskId(model, t.end.taskId)];
          if (ref) e = (t.end.anchor === 'start' ? ref.start : ref.end) + (t.end.offsetDays || 0) + 1;
        }
      }

      if (s != null && e != null) {
        if (!prev || prev.start !== s || prev.end !== e) { r.taskDays[t.id] = { start: s, end: e }; changed = true; }
      } else if (s != null && t.duration) {
        const effDur = scaleDurationByLoad(t);
        // Extend duration for resource off days that overlap the work period
        const extraOff = countOverlapOffDays(t, s, s + effDur, resOffDays);
        const end = s + effDur + extraOff;
        if (!prev || prev.start !== s || prev.end !== end) { r.taskDays[t.id] = { start: s, end: end }; changed = true; }
      } else if (!prev && t.duration) {
        const effDur = scaleDurationByLoad(t);
        const extraOff = countOverlapOffDays(t, 0, effDur, resOffDays);
        r.taskDays[t.id] = { start: 0, end: effDur + extraOff }; changed = true;
      }
    }
    if (!changed) break;
  }

  return r;
}

function findTaskId(model: GanttModel, labelOrAlias: string): string {
  const t = model.tasks.find(t => t.label === labelOrAlias || t.aliasId === labelOrAlias || t.alias === labelOrAlias);
  return t?.id || labelOrAlias;
}

/** Resolve a date expression to day offset from minDay (for resource off dates). */
function resolveOffDateGen(expr: any, minDay: Date): number | null {
  if (!expr) return null;
  if (expr.type === 'absolute') return dateOffRes(parseDateRes(expr.date), minDay);
  return null;
}

/** Build a map of resource name → array of off-day offsets. */
function buildResourceOffDays(model: GanttModel, minDay: Date): Map<string, number[]> {
  const resOffDays = new Map<string, number[]>();
  for (const res of model.resources || []) {
    if (!res.offDates) continue;
    const offDays: number[] = [];
    for (const off of res.offDates) {
      const from = resolveOffDateGen(off.from, minDay);
      const to = resolveOffDateGen(off.to, minDay);
      if (from != null && to != null) {
        for (let d = Math.min(from, to); d <= Math.max(from, to); d++) {
          offDays.push(d);
        }
      }
    }
    if (offDays.length > 0) resOffDays.set(res.name, offDays);
  }
  return resOffDays;
}

/** Count how many resource off days overlap with [startDay, endDay) for a task's resources. */
function countOverlapOffDays(task: GanttTask, startDay: number, endDay: number, resOffDays: Map<string, number[]>): number {
  if (!task.resources || task.resources.length === 0) return 0;
  const offSet = new Set<number>();
  for (const r of task.resources) {
    const days = resOffDays.get(r.name);
    if (!days) continue;
    for (const d of days) {
      if (d >= startDay && d < endDay) offSet.add(d);
    }
  }
  return offSet.size;
}

/** Check if a specific resource is off on a given day offset. */
function isResourceOffDay(resName: string, dayOffset: number, resOffDays: Map<string, number[]>): boolean {
  const days = resOffDays.get(resName);
  if (!days) return false;
  return days.includes(dayOffset);
}

function dateOffRes(d: Date, minDay: Date): number {
  return Math.round((d.getTime() - minDay.getTime()) / 86400000);
}

function parseDateRes(s: string): Date {
  const iso = s.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  return new Date(s);
}

/** Scale work duration to elapsed duration based on resource load (raw float, no rounding). */
function scaleDurationByLoad(task: any): number {
  if (!task.resources || task.resources.length === 0) return task.duration?.value ?? 0;
  const totalLoad = task.resources.reduce((sum: number, r: any) => sum + (r.load ?? 100), 0);
  if (totalLoad <= 0) return task.duration?.value ?? 0;
  const effectiveLoad = Math.min(totalLoad, 400);
  return (task.duration?.value ?? 0) * 100 / effectiveLoad;
}

function getEffectiveScaleForResource(model: GanttModel): { effectiveScale: string } {
  const printUnit = model.config.printScale?.unit?.toLowerCase();
  let scale = 'daily';
  if (printUnit) {
    if (printUnit.startsWith('w')) scale = 'weekly';
    else if (printUnit.startsWith('m')) scale = 'monthly';
    else if (printUnit.startsWith('q')) scale = 'quarterly';
    else if (printUnit.startsWith('y')) scale = 'yearly';
  } else if (model.config.scale) {
    scale = model.config.scale;
  }
  return { effectiveScale: scale };
}

function scaleToPeriodDays(scale: string): number {
  switch (scale) {
    case 'weekly': return 7;
    case 'monthly': return 30;
    case 'quarterly': return 90;
    case 'yearly': return 365;
    default: return 1;
  }
}

function _resolveDate(expr: any): Date | null {
  if (!expr) return null;
  if (expr.type === 'absolute') {
    const s = String(expr.date).replace(/^the\s+/i, '').trim();
    // Handle YYYY-MM-DD and YYYY/MM/DD
    const iso = s.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ═══ Scale-aware header rendering ════════════════════════════════════════════

function dayOffset(date: Date, minDate: Date): number {
  return Math.round((date.getTime() - minDate.getTime()) / 86400000);
}

function renderScaleHeader(
  cells: string[], gMinDate: Date, gMaxDate: Date,
  dayW: number, timelineX: number, headerH: number, gridBottom: number,
  scale: string, hasProjectStart: boolean, theme: Theme, monthNames: string[],
  startD: number,
  weekNumberingFrom?: number,
  calendarDate?: boolean,
  weekStartsOn?: number,
  weekMinDays?: number,
): void {
  const labelStyle = `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${theme.fontSize - 2};fontFamily=${theme.fontFamily};fontColor=${theme.fontColor};align=center;verticalAlign=middle;`;

  const gridLineFill = theme.defaultFill;
  const gridLineW = theme.padXXS;
  const dayToX = (d: number) => Math.round(timelineX + (d - startD) * dayW);

  const drawGrid = (d: number, id: string) => {
    const x = dayToX(d);
    cells.push(mxVertex({
      id, parent: '1', value: '',
      style: `shape=rect;fillColor=${gridLineFill};strokeColor=none;html=1;`,
      x: x - 1, y: Math.round(headerH / 2),
      width: gridLineW, height: gridBottom - Math.round(headerH / 2),
    }));
  };

  const drawLabel = (dStart: number, dEnd: number, text: string, topHalf: boolean, id: string) => {
    const xStart = dayToX(dStart);
    const xEnd = dayToX(dEnd);
    const w = Math.max(theme.sizeS, xEnd - xStart);
    cells.push(mxVertex({
      id, parent: '1', value: text,
      style: labelStyle + (topHalf ? ';fontStyle=1' : ''),
      x: xStart, y: topHalf ? 0 : headerH / 2,
      width: w, height: headerH / 2,
    }));
  };

  const totalDays = dayOffset(gMaxDate, gMinDate);

  if (scale === 'weekly') {
    // Align to configured week-start day (default Monday=1).
    const gMin = new Date(gMinDate); gMin.setHours(0, 0, 0, 0);
    const startDow = gMin.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const wsDay = weekStartsOn ?? 1; // default Monday
    const daysToWeekStart = (7 + wsDay - startDow) % 7; // days until first week-start boundary
    let prevMonth = -1, monthStartD = 0;

    // Helper: draw month label when month changes
    const flushMonth = (d: number, curDate: Date) => {
      if (!hasProjectStart) return;
      const m = curDate.getMonth();
      if (m !== prevMonth) {
        if (prevMonth >= 0 && d > monthStartD) {
          drawLabel(monthStartD, d, `${monthNames[prevMonth]} ${curDate.getFullYear() - (m < prevMonth ? 1 : 0)}`, true, `mon_w${monthStartD}`);
        }
        prevMonth = m;
        monthStartD = d;
      }
    };

    // First grid line at project start
    drawGrid(0, 'grid_wStart');

    let idx = 0;
    // Sequential week counter for custom week numbering (used when weekNumberingFrom is set)
    let weekNum = weekNumberingFrom ?? 0;
    if (daysToWeekStart > 0 && daysToWeekStart < totalDays) {
      // Partial first week (no label)
      const cur = new Date(gMin); cur.setDate(cur.getDate() + daysToWeekStart);
      flushMonth(daysToWeekStart, cur);
      drawGrid(daysToWeekStart, `grid_wA`);
      idx++;
    }

    // Full weeks aligned to week-start day
    let d = daysToWeekStart > 0 ? daysToWeekStart : 0;
    const minDays = weekMinDays; // undefined means never label partial last week
    // Helper: compute week label for day offset d (start of the week)
    const weekLabel = (wkStartD: number) => {
      if (calendarDate) {
        const wd = new Date(gMin); wd.setDate(wd.getDate() + wkStartD);
        return String(wd.getDate());
      }
      if (weekNumberingFrom !== undefined) return weekNum;
      if (hasProjectStart) {
        // PlantUML: when weekStartsOn != Monday, use calendar week numbering
        // Week 1 = the week (wsDay-based) containing Jan 1 of the project year
        if (wsDay !== 1) {
          return 1 + Math.floor((wkStartD + startDow) / 7);
        }
        // Default Monday: use ISO week number
        const wd = new Date(gMin); wd.setDate(wd.getDate() + wkStartD);
        return getISOWeekNumber(wd);
      }
      return idx + 1 - (daysToWeekStart > 0 ? 1 : 0);
    };
    // If project starts on week-start day, first week starts at d=0
    if (d === 0 && daysToWeekStart === 0) {
      // Project starts on week-start day — check if first week is full
      const firstWeekEnd = Math.min(7, totalDays);
      const cur = new Date(gMin); cur.setDate(cur.getDate() + firstWeekEnd);
      flushMonth(firstWeekEnd, cur);
      if (firstWeekEnd >= 7) {
        drawLabel(0, firstWeekEnd, `${weekLabel(0)}`, false, `week_0`);
        if (weekNumberingFrom !== undefined) weekNum++;
      }
      drawGrid(firstWeekEnd, `grid_wB`);
      d = firstWeekEnd;
      idx++;
    }

    while (d < totalDays) {
      const nextD = Math.min(d + 7, totalDays);
      const cur = new Date(gMin); cur.setDate(cur.getDate() + nextD);
      flushMonth(nextD, cur);

      drawGrid(nextD, `grid_w${idx}`);

      // Label full 7-day weeks; suppress last partial week unless weekMinDays is set
      const weekLen = nextD - d;
      const isLastPartial = nextD >= totalDays && weekLen < 7;
      if (weekLen >= 7 || (isLastPartial && minDays !== undefined && weekLen >= minDays)) {
        drawLabel(d, nextD, `${weekLabel(d)}`, false, `week_${idx}`);
        if (weekNumberingFrom !== undefined) weekNum++;
      }

      d = nextD;
      idx++;
    }

    // Flush final month label
    if (hasProjectStart && prevMonth >= 0 && totalDays > monthStartD) {
      const cur = new Date(gMin); cur.setDate(cur.getDate() + totalDays);
      drawLabel(monthStartD, totalDays, `${monthNames[prevMonth]} ${cur.getFullYear()}`, true, `mon_w${monthStartD}`);
    }

  } else if (scale === 'monthly') {
    let d = 0;
    let prevYear = -1, yearStartD = 0;

    while (d < totalDays) {
      const cur = new Date(gMinDate); cur.setDate(cur.getDate() + d);
      const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      let dEnd = dayOffset(nextMonth, gMinDate);
      dEnd = Math.min(dEnd, totalDays);
      // Guard: ensure progress to avoid infinite loop
      if (dEnd <= d) dEnd = Math.min(d + 1, totalDays);

      drawGrid(d, `grid_m${cur.getFullYear()}_${cur.getMonth()}`);

      if (d < totalDays) {
        drawLabel(d, dEnd, monthNames[cur.getMonth()], false, `mon_m${cur.getFullYear()}_${cur.getMonth()}`);
      }

      if (hasProjectStart) {
        const y = cur.getFullYear();
        if (y !== prevYear) {
          if (prevYear >= 0 && d > yearStartD) {
            drawLabel(yearStartD, d, String(prevYear), true, `year_${prevYear}`);
          }
          prevYear = y;
          yearStartD = d;
        }
      }

      d = dEnd;
    }
    if (hasProjectStart && prevYear >= 0 && totalDays > yearStartD) {
      drawLabel(yearStartD, totalDays, String(prevYear), true, `year_${prevYear}`);
    }
    drawGrid(totalDays, 'grid_mEnd');

  } else if (scale === 'quarterly') {
    let d = 0;
    let prevYear = -1, yearStartD = 0;
    const qNames = ['Q1','Q2','Q3','Q4'];

    while (d < totalDays) {
      const cur = new Date(gMinDate); cur.setDate(cur.getDate() + d);
      const q = Math.floor(cur.getMonth() / 3);
      const nextQ = new Date(cur.getFullYear(), (q + 1) * 3, 1);
      let dEnd = dayOffset(nextQ, gMinDate);
      dEnd = Math.min(dEnd, totalDays);
      // Guard: ensure progress to avoid infinite loop
      if (dEnd <= d) dEnd = Math.min(d + 1, totalDays);

      drawGrid(d, `grid_q${cur.getFullYear()}_${q}`);

      if (d < totalDays) {
        drawLabel(d, dEnd, qNames[q], false, `qtr_${cur.getFullYear()}_${q}`);
      }

      if (hasProjectStart) {
        const y = cur.getFullYear();
        if (y !== prevYear) {
          if (prevYear >= 0 && d > yearStartD) {
            drawLabel(yearStartD, d, String(prevYear), true, `year_q${prevYear}`);
          }
          prevYear = y;
          yearStartD = d;
        }
      }

      d = dEnd;
    }
    if (hasProjectStart && prevYear >= 0 && totalDays > yearStartD) {
      drawLabel(yearStartD, totalDays, String(prevYear), true, `year_q${prevYear}`);
    }
    drawGrid(totalDays, 'grid_qEnd');
  } else if (scale === 'yearly') {
    // Yearly: grid lines at year boundaries (Jan 1), year labels in full header
    drawGrid(0, 'grid_yStart');

    // Find first Jan 1 on or after project start
    const startDate = new Date(gMinDate);
    let firstJan1: number;
    if (startDate.getMonth() === 0 && startDate.getDate() === 1) {
      firstJan1 = 0;
    } else {
      const nextJan1 = new Date(startDate.getFullYear() + 1, 0, 1);
      firstJan1 = dayOffset(nextJan1, gMinDate);
    }

    let d = firstJan1;
    while (d < totalDays) {
      const cur = new Date(gMinDate); cur.setDate(cur.getDate() + d);
      drawGrid(d, `grid_y${cur.getFullYear()}`);

      const nextJan1 = new Date(cur.getFullYear() + 1, 0, 1);
      let dEnd = dayOffset(nextJan1, gMinDate);
      dEnd = Math.min(dEnd, totalDays);
      if (dEnd <= d) dEnd = Math.min(d + 1, totalDays); // guard against infinite loop

      if (d < totalDays && dEnd > d) {
        // Year label spanning full header height, bold
        const xStart = dayToX(d);
        const xEnd = dayToX(dEnd);
        const w = Math.max(theme.sizeS, xEnd - xStart);
        cells.push(mxVertex({
          id: `year_${cur.getFullYear()}`, parent: '1',
          value: String(cur.getFullYear()),
          style: labelStyle + ';fontStyle=1',
          x: xStart, y: 0,
          width: w, height: headerH,
        }));
      }

      d = dEnd;
    }
    drawGrid(totalDays, 'grid_yEnd');
  }
}

// ISO week number (1-53)
function getISOWeekNumber(d: Date): number {
  const tmp = new Date(d);
  tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - (tmp.getDay() + 6) % 7);
  const jan4 = new Date(tmp.getFullYear(), 0, 4);
  return 1 + Math.round((tmp.getTime() - jan4.getTime()) / 604800000);
}
