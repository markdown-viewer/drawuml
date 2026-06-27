/**
 * Gantt chart layout — PlantUML-aligned integer day-offset model.
 * - Relative dates resolved via iterative propagation (3 passes).
 * - Orthogonal edge routing with arrowheads.
 */
import type { GanttModel, GanttDateExpr, GanttTask } from '../model/gantt-model.ts';
import type { Renderer } from '../primitives/renderer.ts';
import { createRenderer } from '../primitives/registry.ts';
import type { Theme } from '../shared/theme.ts';
import { createTheme } from '../shared/theme.ts';

export interface GanttLayoutNode { id: string; x: number; y: number; width: number; height: number; }
export interface GanttLayoutEdge { fromId: string; toId: string; waypoints?: { x: number; y: number }[]; }
export interface GanttLayoutResult { nodes: Record<string, GanttLayoutNode>; edges: GanttLayoutEdge[]; width: number; height: number; timelineConfig: GanttTimelineConfig; rowCount: number; }
export interface GanttTimelineConfig { minDate: Date; maxDate: Date; dayWidth: number; scale: string; headerHeight: number; taskListWidth: number; rowHeight: number; printFromOff?: number; }
export interface GanttLayoutOptions { theme?: Theme; renderers?: Map<string, Renderer>; }

/** Build display label with resource info: "Task1 {Alice}" or "Task2 {Bob:50%}".
 *  When hideResourcesNames is true, resource suffixes are omitted. */
function buildTaskDisplayLabel(task: GanttTask, hideResourcesNames?: boolean): string {
  if (!task.resources || task.resources.length === 0) return task.label;
  if (hideResourcesNames) return task.label;
  const parts = task.resources.map(r => {
    if (r.load !== undefined && r.load !== 100) {
      return `{${r.name}:${r.load}%}`;
    }
    return `{${r.name}}`;
  });
  return `${task.label} ${parts.join(' ')}`;
}

/** Scale work duration to elapsed duration based on resource load percentage.
 *  e.g., 2 weeks at 50% load → 4 weeks elapsed time. */
function scaleDurationByResourceLoad(task: GanttTask): number {
  if (!task.resources || task.resources.length === 0) return task.duration?.value ?? 0;
  const totalLoad = task.resources.reduce((sum, r) => sum + (r.load ?? 100), 0);
  // Clamp totalLoad to avoid division by zero; cap at reasonable max
  if (totalLoad <= 0) return task.duration?.value ?? 0;
  const effectiveLoad = Math.min(totalLoad, 400); // cap at 400% (4x full-time)
  return Math.round((task.duration?.value ?? 0) * 100 / effectiveLoad);
}

export function ganttLayout(model: GanttModel, options: GanttLayoutOptions = {}): { renderers: Map<string, Renderer>; layout: GanttLayoutResult } {
  const theme = options.theme || createTheme();
  const renderers = options.renderers || new Map();
  // Layout sizes derived from fontSize so everything scales proportionally
  const baseHeaderH = Math.round(theme.fontSize * 40 / 12); // 40 @12
  const baseDayW = Math.round(theme.fontSize * 20 / 12);    // 20 @12
  // bar height = fontSize + 12; rowH = barH + 2×padXXS (padXXS = per-side bar gap)
  const barH = theme.fontSize + 12;               // 24 @12, 28 @16
  const rowH = barH + theme.padXXS * 2;           // 28 @12, 33.33 @16
  const nodes: Record<string, GanttLayoutNode> = {};
  const edges: GanttLayoutEdge[] = [];
  const st = model.style || {} as any;
  // PlantUML ref: task bar fill — use style block, then gantt task fill, then dark-mode-aware fill
  const taskFill = st.task?.backgroundColor || theme.ganttTaskFill;
  const taskStroke = st.task?.lineColor || theme.colorDark;

  const resolved = resolveModel(model);
  const margin = theme.padS;
  const minBarW = theme.padXXS;
  const timelineX = margin;
  // Scale factor: printscale/projectscale compress the day width
  const { effectiveScale, scaleCompress } = getEffectiveScale(model, theme);
  const dayW = baseDayW / scaleCompress;
  const headerH = effectiveScale === 'yearly' ? Math.round(baseHeaderH / 2) : baseHeaderH;
  // Print range clipping: shift timeline to start at printRange.from
  const printFromOff = model.config.printRange?.from
    ? dateOff(parseDate(model.config.printRange.from.date), resolved.minDay) : 0;
  const printToOff = model.config.printRange?.to
    ? dateOff(parseDate(model.config.printRange.to.date), resolved.minDay) + 1 : resolved.maxDayOffset; // +1: inclusive→exclusive
  const effectiveMaxOff = model.config.printRange
    ? Math.min(resolved.maxDayOffset, printToOff) : resolved.maxDayOffset;
  // Use print-relative coordinates (shifted so printRange.from starts at timelineX)
  const dayToX = (d: number) => timelineX + (d - printFromOff) * dayW;
  // Common anchor-x function: base x minus a pixel inset.
  // Used by both edge source points (base=task right edge) and milestone diamonds (base=day center).
  const anchorX = (baseX: number, insetPx: number) => baseX - insetPx;
  let row = 0;
  const rowMap: Record<string, number> = {};
  const elements = collectElements(model).sort((a, b) => a._so - b._so);
  const _msByLabel: Record<string, { ms: any; d: number; row: number }> = {};

  for (const el of elements) {
    if (el.type === 'task') {
      const t = el.data;
      if (t.sameRowAsId && rowMap[t.sameRowAsId] !== undefined) { t.row = rowMap[t.sameRowAsId]; }
      else { t.row = row; rowMap[t.label] = row; if (t.aliasId) rowMap[t.aliasId] = row; row++; }
      const rd = resolved.taskDays[t.id];
      const s = rd?.start ?? 0, e = rd?.end ?? (s + (t.duration?.value || 1));
      let barX = dayToX(s), barW = Math.max(minBarW, dayToX(e) - barX);
      // Clip bar to visible print range (plantuml behaviour)
      if (printFromOff > 0) {
        const visibleEnd = timelineX + (printToOff - printFromOff) * dayW;
        if (barX < timelineX) {
          const clipL = timelineX - barX;
          barW = Math.max(minBarW, barW - clipL);
          barX = timelineX;
        }
        if (barX + barW > visibleEnd) {
          barW = Math.max(minBarW, visibleEnd - barX);
        }
      }
      const hasCompletion = t.completion !== undefined;
      const isUnstarted = t.completion === 0;
      // PlantUML: HColors.unlinear(unstarted, regular, completion) — cubic HSL blend
      // Default: unstarted = regular = taskFill, so blend is constant (no visible blending)
      // Only when explicit unstarted style is set does the blend produce intermediate colors
      const regularBg = st.task?.backgroundColor || taskFill;
      const unstartedBg = st.unstarted?.backgroundColor
        || (hasCompletion ? regularBg : undefined);
      const taskColor = hasCompletion && unstartedBg
        ? unlinearColor(unstartedBg, regularBg, t.completion ?? 0)
        : (t.color?.bg || regularBg);
      const unstartedLine = st.unstarted?.lineColor;
      const regularLine = st.task?.lineColor || taskStroke;
      const borderColor = hasCompletion && unstartedLine
        ? unlinearColor(unstartedLine, regularLine, t.completion ?? 0)
        : (t.color?.fg || regularLine);
      // undoneColor: incomplete portion background
      // In dark mode, use dark fill instead of white so the completed portion pops
      const undoneColor = st.undone?.backgroundColor
        || (hasCompletion ? theme.groupFill : taskColor);
      const displayLabel = buildTaskDisplayLabel(t, model.config.hideResourcesNames);
      const r = createRenderer('gantt-bar', { id: t.id, label: displayLabel, color: taskColor, theme, completion: isUnstarted ? 0 : t.completion, strokeColor: t.color?.fg || borderColor, undoneColor } as any);
      renderers.set(t.id, r);
      const m = r.measure();
      const barY = headerH + (t.row || 0) * rowH + Math.floor((rowH - m.height) / 2);
      nodes[t.id] = { id: t.id, x: Math.round(barX), y: Math.round(barY), width: Math.round(barW), height: m.height };
    } else if (el.type === 'sep') {
      const id = `sep_${row}`;
      const r = createRenderer('gantt-separator', { id, label: el.data.label, theme } as any);
      renderers.set(id, r);
      const m = r.measure();
      nodes[id] = { id, x: timelineX, y: Math.round(headerH + row * rowH), width: Math.round((effectiveMaxOff - printFromOff) * dayW), height: m.height };
      row++;
    } else if (el.type === 'ms') {
      const ms = el.data;
      const d = resolved.msDays[ms.id] ?? 0;
      const label = ms.label || '';
      const existing = _msByLabel[label];
      if (!existing || d > existing.d) {
        // Reuse existing row for same-label updates, or take current row for new milestones
        const msRow = existing ? existing.row : row;
        // Remove old milestone's renderer/node if overwriting with a later date
        if (existing) {
          renderers.delete(existing.ms.id);
          delete nodes[existing.ms.id];
        }
        // Milestone color: use style block, then task color, then dark-mode-aware default
        const msBg = ms.color?.bg
          || st.milestone?.backgroundColor
          || theme.defaultFill;
        const msStroke = ms.color?.fg
          || st.milestone?.lineColor
          || theme.colorDark;
        const r = createRenderer('gantt-milestone', { id: ms.id, label: ms.label, color: msBg, strokeColor: msStroke, theme } as any);
        renderers.set(ms.id, r);
        const m = r.measure();
        const msX = anchorX(dayToX(d + 0.5), m.width / 2);
        nodes[ms.id] = { id: ms.id, x: Math.round(msX), y: Math.round(headerH + msRow * rowH + (rowH - m.height) / 2), width: m.width, height: m.height };
        _msByLabel[label] = { ms, d, row: msRow };
        if (!existing) row++;
      }
    }
  }

  // Edge routing: from source last-day bottom → down → right → target left

  for (const dep of model.dependencies) {
    const fn = nodes[dep.from], tn = nodes[dep.to];
    if (!fn || !tn) continue;
    const sx = anchorX(fn.x + fn.width, baseDayW / 2); // task right edge inset half day-unit
    const sy = fn.y + fn.height;
    const tx = tn.x;                        // left edge of target (do not modify)
    const ty = tn.y + tn.height / 2;
    const midY = Math.max(sy + 12, ty);
    edges.push({
      fromId: dep.from, toId: dep.to,
      waypoints: [
        { x: sx, y: sy },
        { x: sx, y: midY },
        { x: tx, y: midY },
        { x: tx, y: ty },
      ],
    });
  }

  const totalW = timelineX + (effectiveMaxOff - printFromOff) * dayW + margin;
  const totalH = headerH + row * rowH + margin;
  const maxDate = new Date(resolved.minDay); maxDate.setDate(maxDate.getDate() + effectiveMaxOff);
  return { renderers, layout: { nodes, edges, width: totalW, height: totalH, timelineConfig: { minDate: resolved.minDay, maxDate, dayWidth: dayW, scale: effectiveScale, headerHeight: headerH, taskListWidth: 0, rowHeight: rowH, printFromOff: printFromOff || undefined }, rowCount: row } };
}

// ═══ Date Resolution ══════════════════════════════════════════════════════════
interface TaskDays { start: number; end: number; }
interface ResolvedModel { minDay: Date; maxDayOffset: number; taskDays: Record<string, TaskDays>; msDays: Record<string, number>; }

/** Scale compress derived from theme size tiers — each period fills its target width.
 *  compress = daysPerPeriod × sizeS / targetSize  (baseDayW = sizeS) */
const SCALE_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };

function getEffectiveScale(model: GanttModel, theme: Theme): { effectiveScale: string; scaleCompress: number } {
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
  // Target cell width per period, mapped to theme size tiers
  const targetSizes: Record<string, number> = {
    daily: theme.sizeS, weekly: theme.sizeM, monthly: theme.sizeL,
    quarterly: theme.sizeXL, yearly: theme.sizeXXL,
  };
  const periodDays = SCALE_DAYS[scale] || 1;
  const targetW = targetSizes[scale] || theme.sizeS;
  // compress = baseDayW / dayW, where dayW = targetW / periodDays, baseDayW = theme.sizeS
  let compress = (periodDays * theme.sizeS) / targetW;
  // Zoom reduces compression (e.g., "zoom 2" means 2x larger → half the compression)
  if (model.config.zoom && model.config.zoom > 0) compress = compress / model.config.zoom;
  return { effectiveScale: scale, scaleCompress: Math.max(0.1, compress) };
}

/** Convert resource off-dates to day-offset ranges keyed by resource name. */
function resolveResourceOffRanges(model: GanttModel, minDay: Date): Map<string, { from: number; to: number }[]> {
  const map = new Map<string, { from: number; to: number }[]>();
  for (const res of model.resources || []) {
    if (!res.offDates || res.offDates.length === 0) continue;
    const ranges: { from: number; to: number }[] = [];
    for (const off of res.offDates) {
      const from = resolveOffDate(off.from, minDay);
      const to = resolveOffDate(off.to, minDay);
      if (from != null && to != null) {
        ranges.push({ from: Math.min(from, to), to: Math.max(from, to) + 1 }); // +1: inclusive→exclusive
      }
    }
    if (ranges.length > 0) map.set(res.name, ranges);
  }
  return map;
}

/** Resolve a single off-date expression to a day offset from minDay. */
function resolveOffDate(expr: GanttDateExpr | undefined, minDay: Date): number | null {
  if (!expr) return null;
  if (expr.type === 'absolute') return dateOff(parseDate(expr.date), minDay);
  return null;
}

/** Get off-day ranges for a task's resources (union of all off ranges across assigned resources). */
function getTaskResourceOffRanges(task: GanttTask, resourceOffRanges: Map<string, { from: number; to: number }[]>): { from: number; to: number }[] {
  if (!task.resources || task.resources.length === 0) return [];
  const merged: { from: number; to: number }[] = [];
  for (const r of task.resources) {
    const ranges = resourceOffRanges.get(r.name);
    if (ranges) merged.push(...ranges);
  }
  return merged;
}

/** Merge two arrays of closed date ranges (union). Both are non-overlapping within themselves. */
function mergeClosedRanges(a: { from: number; to: number }[], b: { from: number; to: number }[]): { from: number; to: number }[] {
  if (b.length === 0) return a;
  if (a.length === 0) return b;
  // Simple concatenation — addWorkingDays iterates day by day, so duplicates don't matter
  return [...a, ...b];
}

function resolveModel(model: GanttModel): ResolvedModel {
  const minDay = model.projectStart ? parseDate(model.projectStart.date) : new Date(2000, 0, 1);
  const r: ResolvedModel = { minDay, maxDayOffset: 0, taskDays: {}, msDays: {} };
  const closedDateRanges = resolveClosedDateRanges(model, minDay);
  // Resource off days: map resource name → off-day offset ranges
  const resourceOffRanges = resolveResourceOffRanges(model, minDay);

  // Iterative resolution (up to 5 passes to propagate relative dates through chains)
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const t of model.tasks) {
      if (t.deleted) continue;
      const s = resolveOffset(t.start, model, minDay, r, model.config.closedDays, closedDateRanges);
      let e = resolveOffset(t.end, model, minDay, r, model.config.closedDays, closedDateRanges);
      if (t.end) e! += 1;
      const prev = r.taskDays[t.id];
      // Scale work duration to elapsed duration based on resource load
      const effDuration = t.duration ? scaleDurationByResourceLoad(t) : undefined;
      // Build task-specific closed date ranges (global + resource off days)
      const taskRanges = mergeClosedRanges(closedDateRanges, getTaskResourceOffRanges(t, resourceOffRanges));
      if (s != null && e != null) {
        if (!prev || prev.start !== s || prev.end !== e) { r.taskDays[t.id] = { start: s, end: e }; changed = true; }
      } else if (s != null && effDuration != null) {
        if (!prev || prev.start !== s) { r.taskDays[t.id] = { start: s, end: addWorkingDays(s, effDuration, minDay, model.config.closedDays, taskRanges) }; changed = true; }
      } else if (e != null && effDuration != null) {
        if (!prev || prev.end !== e) { r.taskDays[t.id] = { start: subtractWorkingDays(e, effDuration, minDay, model.config.closedDays, taskRanges), end: e }; changed = true; }
      } else if (!prev && effDuration != null) {
        r.taskDays[t.id] = { start: 0, end: addWorkingDays(0, effDuration, minDay, model.config.closedDays, taskRanges) }; changed = true;
      }
    }
    if (!changed) break;
  }

  for (const ms of model.milestones) {
    let d = resolveOffset(ms.at, model, minDay, r, model.config.closedDays, closedDateRanges);
    // If milestone at task's end, the end is exclusive → use last actual day
    // Skip for milestone references (milestones have no exclusive end)
    const isTaskRef = ms.at?.type === 'relative_to_task' && model.tasks.some(t => t.label === ms.at!.taskId || t.aliasId === ms.at!.taskId);
    if (ms.at?.type === 'relative_to_task' && ms.at.anchor === 'end' && d != null && isTaskRef) d -= 1;
    r.msDays[ms.id] = d ?? 0;
  }
  for (const td of Object.values(r.taskDays)) { if (td.end > r.maxDayOffset) r.maxDayOffset = td.end; }
  for (const d of Object.values(r.msDays)) { if (d >= r.maxDayOffset) r.maxDayOffset = d + 1; } // +1: milestone is a point, need interval after it
  // Date ranges may extend beyond tasks/milestones
  for (const dr of model.dateRanges) {
    const toOff = resolveOffset(dr.to, model, minDay, r, model.config.closedDays, closedDateRanges);
    if (toOff != null && toOff + 1 > r.maxDayOffset) r.maxDayOffset = toOff + 1; // +1: inclusive→exclusive
  }
  return r;
}

function resolveOffset(expr: GanttDateExpr | undefined, model: GanttModel, minDay: Date, resolved: ResolvedModel, closedDays?: number[], closedDateRanges?: { from: number; to: number }[]): number | null {
  if (!expr) return null;
  if (expr.type === 'absolute') return dateOff(parseDate(expr.date), minDay);
  if (expr.type === 'offset_from_start') return expr.days;
  if (expr.type === 'today') return dateOff(new Date(), minDay);
  if (expr.type === 'relative_to_task') {
    // Try task first, then milestone
    const refTask = model.tasks.find(t => t.label === expr.taskId || t.aliasId === expr.taskId || t.alias === expr.taskId);
    if (refTask) {
      const ref = resolved.taskDays[refTask.id];
      if (!ref) return null;
      const base = expr.anchor === 'start' ? ref.start : ref.end;
      const off = expr.offsetDays || 0;
      // If workingDays is set, apply closed-day skipping to the offset
      if (expr.workingDays && off !== 0) {
        return off > 0
          ? addWorkingDays(base, off, minDay, closedDays, closedDateRanges) - 1  // -1: addWorkingDays returns exclusive end
          : subtractWorkingDays(base, -off, minDay, closedDays, closedDateRanges);
      }
      return base + off;
    }
    // Check if reference is to a milestone
    const refMs = model.milestones.find(m => m.label === expr.taskId);
    if (refMs) {
      const ref = resolved.msDays[refMs.id];
      if (ref == null) return null;
      return ref + (expr.offsetDays || 0);
    }
    return null;
  }
  return null;
}

function dateOff(d: Date, minDay: Date): number { return Math.round((d.getTime() - minDay.getTime()) / 86400000); }

/** Check if a given day offset (from minDay) is a closed day (weekend/holiday/closed date range). */
function isClosedDay(dayOffset: number, minDay: Date, closedDays?: number[], closedDateRanges?: { from: number; to: number }[]): boolean {
  if (closedDays && closedDays.length > 0) {
    const d = new Date(minDay);
    d.setDate(d.getDate() + dayOffset);
    if (closedDays.includes(d.getDay())) return true;
  }
  if (closedDateRanges) {
    for (const r of closedDateRanges) {
      if (dayOffset >= r.from && dayOffset < r.to) return true;
    }
  }
  return false;
}

/** Convert model's closedDates to day-offset ranges from minDay, then subtract openDates. */
function resolveClosedDateRanges(model: GanttModel, minDay: Date): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const cd of model.config.closedDates || []) {
    const from = resolveOffset(cd.from, model, minDay, { minDay, maxDayOffset: 0, taskDays: {}, msDays: {} });
    const to = resolveOffset(cd.to, model, minDay, { minDay, maxDayOffset: 0, taskDays: {}, msDays: {} });
    if (from != null && to != null) {
      ranges.push({ from: Math.min(from, to), to: Math.max(from, to) + 1 }); // +1: inclusive→exclusive
    }
  }
  // Apply open dates: remove open days from closed ranges, splitting if necessary
  if (model.config.openDates && model.config.openDates.length > 0) {
    for (const od of model.config.openDates) {
      const openOff = resolveOffset(od.date, model, minDay, { minDay, maxDayOffset: 0, taskDays: {}, msDays: {} });
      if (openOff == null) continue;
      const newRanges: { from: number; to: number }[] = [];
      for (const r of ranges) {
        if (openOff >= r.from && openOff < r.to) {
          if (openOff > r.from) newRanges.push({ from: r.from, to: openOff });
          if (openOff + 1 < r.to) newRanges.push({ from: openOff + 1, to: r.to });
        } else {
          newRanges.push(r);
        }
      }
      ranges.length = 0;
      for (const nr of newRanges) ranges.push(nr);
    }
  }
  return ranges;
}

/** Add N working days to startDay (inclusive), return exclusive end day offset. */
function addWorkingDays(startDay: number, numDays: number, minDay: Date, closedDays?: number[], closedDateRanges?: { from: number; to: number }[]): number {
  if ((!closedDays || closedDays.length === 0) && (!closedDateRanges || closedDateRanges.length === 0)) return startDay + numDays;
  let remaining = numDays;
  let day = startDay;
  while (remaining > 0) {
    if (!isClosedDay(day, minDay, closedDays, closedDateRanges)) remaining--;
    day++;
  }
  return day;
}

/** Subtract N working days from endDay (exclusive), return start day offset. */
function subtractWorkingDays(endDay: number, numDays: number, minDay: Date, closedDays?: number[], closedDateRanges?: { from: number; to: number }[]): number {
  if ((!closedDays || closedDays.length === 0) && (!closedDateRanges || closedDateRanges.length === 0)) return endDay - numDays;
  let remaining = numDays;
  let day = endDay;
  while (remaining > 0) {
    day--;
    if (!isClosedDay(day, minDay, closedDays, closedDateRanges)) remaining--;
  }
  return day;
}

/** PlantUML's HColors.unlinear: cubic HSL blend between two colors. */
function unlinearColor(c1: string, c2: string, completion: number): string {
  const f = Math.pow(completion / 100, 3);
  const h1 = hexToHsl(resolveColor(c1)), h2 = hexToHsl(resolveColor(c2));
  const h = h1[0] + (h2[0] - h1[0]) * f;
  const s = h1[1] + (h2[1] - h1[1]) * f;
  const l = h1[2] + (h2[2] - h1[2]) * f;
  return hslToHex(h, s, l);
}
/** Resolve CSS named colors to hex. */
function resolveColor(c: string): string {
  if (c.startsWith('#')) return c;
  const named: Record<string, string> = {
    red:'#FF0000',green:'#008000',blue:'#0000FF',yellow:'#FFFF00',white:'#FFFFFF',black:'#000000',
    fuchsia:'#FF00FF',greenyellow:'#ADFF2F',firebrick:'#B22222',orange:'#FFA500',
    pink:'#FFC0CB',lightblue:'#ADD8E6',lightgreen:'#90EE90',lavender:'#E6E6FA',
    salmon:'#FA8072',coral:'#FF7F50',gray:'#808080',grey:'#808080',bisque:'#FFE4C4',
    darkgreen:'#006400',purple:'#800080',cyan:'#00FFFF',magenta:'#FF00FF',
  };
  return named[c.toLowerCase().replace(/\s/g,'')] || c;
}
function hexToHsl(hex: string): [number, number, number] {
  let r = 0, g = 0, b = 0;
  const h = hex.replace('#', '');
  if (h.length === 3) { r = parseInt(h[0]+h[0], 16); g = parseInt(h[1]+h[1], 16); b = parseInt(h[2]+h[2], 16); }
  else if (h.length >= 6) { r = parseInt(h.substring(0,2), 16); g = parseInt(h.substring(2,4), 16); b = parseInt(h.substring(4,6), 16); }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h2 = 0, s2 = 0, l2 = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s2 = l2 > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h2 = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h2 = ((b - r) / d + 2) / 6;
    else h2 = ((r - g) / d + 4) / 6;
  }
  return [h2, s2, l2];
}
function hslToHex(h: number, s: number, l: number): string {
  const hue2rgb = (p: number, q: number, t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q-p)*6*t; if (t < 1/2) return q; if (t < 2/3) return p + (q-p)*(2/3-t)*6; return p; };
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3); }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function parseDate(s: string): Date {
  const c = s.replace(/^the\s+/i, '').replace(/^at\s+/i, '').trim();
  const iso = c.match(/(\d{4})[-\/](\d{2})[-\/](\d{2})/);
  if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
  const nl = c.match(/(\d+)(?:st|nd|rd|th)?\s+of\s+(\w+)\s+(\d{4})/i);
  if (nl) {
    const m: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
    const mi = m[(nl[2] || '').toLowerCase()];
    if (mi !== undefined) return new Date(parseInt(nl[3]), mi, parseInt(nl[1]));
  }
  return new Date(c);
}

// ═══ Element ordering ════════════════════════════════════════════════════════
interface RowElement { type: string; data: any; _so: number; }
function collectElements(model: GanttModel): RowElement[] {
  const out: RowElement[] = [];
  for (const t of model.tasks) if (!t.deleted) out.push({ type: 'task', data: t, _so: (t as any)._so ?? 0 });
  for (const s of model.separators) out.push({ type: 'sep', data: s, _so: (s as any)._so ?? 999 });
  for (const m of model.milestones) out.push({ type: 'ms', data: m, _so: (m as any)._so ?? 999 });
  return out;
}
