/**
 * Gantt chart semantic parser — Phase 2.
 * PEG statements → GanttModel with full rest-line extraction.
 */
import type { GanttModel, GanttTask, GanttDependency, GanttMilestone, GanttSeparator, GanttDateRange, GanttConfig, GanttDateExpr, GanttResourceRef } from '../model/gantt-model.ts';

export function parseGanttStatements(statements: any[], pragmas: Record<string, string> = {}): GanttModel {
  const ctx: ParseContext = { model: { tasks: [], dependencies: [], milestones: [], separators: [], dateRanges: [], notes: [], resources: [], config: {} }, lastTaskId: null, taskIndex: 0, msIdx: 0, sepIdx: 0, noteBuf: null, _order: 0 };

  for (const st of statements) {
    if (!st) continue;
    switch (st.type || st.kind) {
      case 'gantt_task': t_task(ctx, st); break;
      case 'gantt_dependency': t_dep(ctx, st); break;
      case 'gantt_milestone': t_ms(ctx, st); break;
      case 'gantt_coloring': t_color(ctx, st); break;
      case 'gantt_completion': t_comp(ctx, st); break;
      case 'gantt_deleted': t_del(ctx, st); break;
      case 'gantt_separator': t_sep(ctx, st); break;
      case 'gantt_config': t_cfg(ctx, st); break;
      case 'gantt_resource_off': t_resOff(ctx, st); break;
      case 'style_block_start':
        t_styleBlock(ctx, st); break;
      case 'style_text_line':
        t_styleText(ctx, st); break;
      case 'style_block_end': case 'comment_line': case 'blank_line': break;
      case 'note_start': ctx.noteBuf = { lines: [], position: 'bottom' }; break;
      case 'note_text_line': if (ctx.noteBuf) ctx.noteBuf.lines.push(st.text || ''); break;
      case 'note_end': if (ctx.noteBuf?.lines.length) { ctx.model.notes.push({ lines: [...ctx.noteBuf.lines], position: ctx.noteBuf.position }); ctx.noteBuf = null; } break;
      default: t_generic(ctx, st); break;
    }
  }
  // Deduplicate milestones by date is handled in gantt-layout (compares resolved day offsets)
  if (ctx.noteBuf?.lines.length) ctx.model.notes.push({ lines: [...ctx.noteBuf.lines], position: ctx.noteBuf.position });
  return ctx.model;
}

interface ParseContext { model: GanttModel; lastTaskId: string | null; taskIndex: number; msIdx: number; sepIdx: number; noteBuf: { lines: string[]; position?: string } | null; _styleSelector?: string; _styleDepth?: number; _legendLines?: string[]; _order: number; }

// ── Task rest parsing ────────────────────────────────────────────────────────

/** Month name set for disambiguation (Format C: MONTH DD YYYY vs other patterns). */
const MONTH_NAMES = new Set([
  'january','february','march','april','may','june','july',
  'august','september','october','november','december',
  'jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec',
]);

function looksLikeMonthFirst(s: string): boolean {
  const firstWord = s.trim().split(/\s+/, 1)[0].toLowerCase().replace(/[^a-z]/g, '');
  return MONTH_NAMES.has(firstWord);
}

/** Parse "on {Alice} {Bob:50%}" → resource ref list. Each {Name} or {Name:load%}. */
function parseResourceList(matched: string): GanttResourceRef[] {
  const resources: GanttResourceRef[] = [];
  // Extract each {Name} or {Name:load} block
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(matched)) !== null) {
    const inner = m[1].trim();
    if (!inner) continue;
    const p = inner.split(':');
    const name = p[0].trim();
    if (!name) continue;
    const loadStr = p[1] ? p[1].trim().replace(/%$/, '') : '';
    const load = loadStr ? parseInt(loadStr) : undefined;
    resources.push({ name, ...(load !== undefined ? { load } : {}) });
  }
  return resources;
}

function parseTaskRest(rest: string, daysInWeek = 7): Partial<GanttTask> {
  const r: Partial<GanttTask> = {}; if (!rest) return r; let s = rest;
  const am = s.match(/^as\s+\[([^\]]+)\]/); if (am) { r.alias = am[1]; r.aliasId = am[1]; s = s.substring(am[0].length).trim(); }
  // Duration: prefer "requires/lasts/needs N days", fallback to generic "N days"
  let dm = s.match(/(?:requires?|lasts?|needs?)\s+(\d+)\s+(day|week|month|year)s?\b/i);
  if (!dm) dm = s.match(/^(\d+)\s+(day|week|month|year)s?\b/i); // generic only at start of rest
  if (dm) { let d = parseInt(dm[1]); if (dm[2].toLowerCase().startsWith('w')) d *= daysInWeek; else if (dm[2].toLowerCase().startsWith('m')) d *= 30; else if (dm[2].toLowerCase().startsWith('y')) d *= 365; r.duration = { value: d, unit: 'day' }; }
  const cm = s.match(/is\s+(\d+)%\s+(?:completed|complete)/i); if (cm) r.completion = parseInt(cm[1]);
  if (/\bis\s+deleted\b/.test(s)) r.deleted = true;
  const clm = s.match(/is\s+colored\s+in\s+(\S+?)(?:\s*\/\s*(\S+))?(?:\s|$)/); if (clm) r.color = { bg: clm[1], fg: clm[2] || clm[1] };
  const rm = s.match(/on\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/); if (rm) r.resources = parseResourceList(rm[1]);
  const absS = s.match(/starts?\s+(?:at\s+|on\s+)?(\d{4}[-\/]\d{2}[-\/]\d{2})/); if (absS) r.start = { type: 'absolute', date: absS[1] };
  const absE = s.match(/(?:and\s+)?ends?\s+(?:at\s+|on\s+)?(\d{4}[-\/]\d{2}[-\/]\d{2})/); if (absE) r.end = { type: 'absolute', date: absE[1] };
  // Human-readable dates: "starts the 1st of january 2026" / "ends the 30th of june 2026"
  // PlantUML ref: DayPattern + ComplementDate.any() — format A: DD MONTH YYYY
  const absSh = s.match(/starts?\s+(?:at\s+|on\s+)?((?:the\s+)?\d+(?:st|nd|rd|th)?\s+of\s+\w+\s+\d{4})/i); if (absSh) r.start = { type: 'absolute', date: absSh[1] };
  const absEh = s.match(/(?:and\s+)?ends?\s+(?:at\s+|on\s+)?((?:the\s+)?\d+(?:st|nd|rd|th)?\s+of\s+\w+\s+\d{4})/i); if (absEh) r.end = { type: 'absolute', date: absEh[1] };
  // Format C: MONTH DD YYYY — e.g., "starts January 15 2024" / "ends Feb 1 2025"
  // PlantUML ref: TimeResolution.toUbrexC_MONTH_DD_YYYY
  const absSc = s.match(/starts?\s+(?:at\s+|on\s+)?((?:the\s+)?\w+\s+\d+(?:st|nd|rd|th)?,?\s+\d{4})/i); if (absSc && looksLikeMonthFirst(absSc[1])) r.start = { type: 'absolute', date: absSc[1] };
  const absEc = s.match(/(?:and\s+)?ends?\s+(?:at\s+|on\s+)?((?:the\s+)?\w+\s+\d+(?:st|nd|rd|th)?,?\s+\d{4})/i); if (absEc && looksLikeMonthFirst(absEc[1])) r.end = { type: 'absolute', date: absEc[1] };
  const offS = s.match(/starts?\s+D\+(\d+)/); if (offS) r.start = { type: 'offset_from_start', days: parseInt(offS[1]) };
  const offE = s.match(/ends?\s+D\+(\d+)/); if (offE) r.end = { type: 'offset_from_start', days: parseInt(offE[1]) };
  const relS = s.match(/starts?\s+at\s+\[([^\]]+)\]\'s\s+(start|end)/); if (relS) r.start = { type: 'relative_to_task', taskId: relS[1], anchor: relS[2] as any };
  const relE = s.match(/ends?\s+at\s+\[([^\]]+)\]\'s\s+(start|end)/); if (relE) r.end = { type: 'relative_to_task', taskId: relE[1], anchor: relE[2] as any };
  const roS = s.match(/starts?\s+(\d+)\s+days?\s+(after|before)\s+\[([^\]]+)\]\'s\s+(start|end)/); if (roS) r.start = { type: 'relative_to_task', taskId: roS[3], anchor: roS[4] as any, offsetDays: parseInt(roS[1]) * (roS[2] === 'before' ? -1 : 1) };
  const roE = s.match(/ends?\s+(\d+)\s+days?\s+(after|before)\s+\[([^\]]+)\]\'s\s+(start|end)/); if (roE) r.end = { type: 'relative_to_task', taskId: roE[3], anchor: roE[4] as any, offsetDays: parseInt(roE[1]) * (roE[2] === 'before' ? -1 : 1) };
  const lm = s.match(/links?\s+to\s+\[\[([^\]]+)\]\]/); if (lm) r.url = lm[1];
  const rowM = s.match(/displays?\s+on\s+same\s+row\s+as\s+\[([^\]]+)\]/); if (rowM) r.sameRowAsId = rowM[1];
  // Inline arrow style: with blue dotted link / with green bold link / with green dashed link
  const asm = s.match(/with\s+(\S+)\s+(dotted|dashed|bold)\s+link/i); if (asm) r.inlineArrowStyle = { color: asm[1], style: asm[2].toLowerCase() as any };
  // Working days: N working days after
  const wd = s.match(/starts?\s+(\d+)\s+working\s+days?\s+(after|before)\s+\[([^\]]+)\]\'s\s+(start|end)/); if (wd) r.start = { type: 'relative_to_task', taskId: wd[3], anchor: wd[4] as any, offsetDays: parseInt(wd[1]) * (wd[2] === 'before' ? -1 : 1), workingDays: true };
  const cdm = s.match(/(\d+)\s+week(?:s)?\s+and\s+(\d+)\s+day(?:s)?/i); if (cdm) r.duration = { value: parseInt(cdm[1]) * daysInWeek + parseInt(cdm[2]), unit: 'day' };
  return r;
}

function parseMilestoneRest(rest: string, daysInWeek = 7): { at?: GanttDateExpr } {
  if (!rest) return {};
  let m: any;
  m = rest.match(/^at\s+\[([^\]]+)\]\'s\s+(start|end)/); if (m) return { at: { type: 'relative_to_task', taskId: m[1], anchor: m[2] as any } };
  m = rest.match(/^on\s+(\d+)\s+(day|week)s?\s+after\s+\[([^\]]+)\]\'s\s+(start|end)/); if (m) return { at: { type: 'relative_to_task', taskId: m[3], anchor: m[4] as any, offsetDays: parseInt(m[1]) * (m[2] === 'week' ? daysInWeek : 1) } };
  m = rest.match(/^(\d+)\s+days?\s+after\s+start/); if (m) return { at: { type: 'offset_from_start', days: parseInt(m[1]) } };
  m = rest.match(/^(\d+)\s+days?\s+after\s+\[([^\]]+)\]\'s\s+(start|end)/); if (m) return { at: { type: 'relative_to_task', taskId: m[2], anchor: m[3] as any, offsetDays: parseInt(m[1]) } };
  // ISO dates: happens 2020-07-03 / happens at 2020-07-03 / happens on 2020-07-03
  m = rest.match(/^(?:at\s+|on\s+)?(\d{4}[-\/]\d{2}[-\/]\d{2})/); if (m) return { at: { type: 'absolute', date: m[1] } };
  m = rest.match(/^at\s+(\d{4}[-\/]\d{2}[-\/]\d{2})/); if (m) return { at: { type: 'absolute', date: m[1] } };
  // Human-readable dates: happens at the 29th of September 2018
  // PlantUML ref: gantt4/gantt5 — "happens at the 29th of September 2018"
  m = rest.match(/^(?:at\s+|on\s+)?((?:the\s+)?\d+(?:st|nd|rd|th)?\s+of\s+\w+\s+\d{4})/i); if (m) return { at: { type: 'absolute', date: m[1] } };
  // Format C: MONTH DD YYYY — e.g., "happens January 15 2024"
  m = rest.match(/^(?:at\s+|on\s+)?((?:the\s+)?\w+\s+\d+(?:st|nd|rd|th)?,?\s+\d{4})/i); if (m && looksLikeMonthFirst(m[1])) return { at: { type: 'absolute', date: m[1] } };
  return {};
}

// ── Handlers ─────────────────────────────────────────────────────────────────
/** Compute effective days-in-week based on closed weekend days. */
function getDaysInWeek(closedDays?: number[]): number {
  if (!closedDays || closedDays.length === 0) return 7;
  let w = 7;
  if (closedDays.includes(0)) w--; // Sunday
  if (closedDays.includes(6)) w--; // Saturday
  return w;
}

function t_task(ctx: ParseContext, st: any): void {
  const diw = getDaysInWeek(ctx.model.config.closedDays);
  const extra = parseTaskRest(st.rest || '', diw);
  // PEG already parsed alias, apply it directly
  if (st.alias) { extra.alias = st.alias; extra.aliasId = st.alias; }
  // Check if a task with this label or alias already exists → merge properties
  // Same label but different alias = different task (see fixture 012)
  let existing = findTask(ctx, st.label || '');
  if (existing && existing.aliasId && extra.aliasId && existing.aliasId !== extra.aliasId) {
    existing = undefined; // different alias → new task
  }
  if (!existing && st.alias) existing = findTask(ctx, st.alias);
  if (existing) {
    Object.assign(existing, extra);
    addImplicitDeps(ctx, existing);
    if (st.isThen && ctx.lastTaskId) { ctx.model.dependencies.push({ from: ctx.lastTaskId, to: existing.id }); if (!existing.start) existing.start = { type: 'relative_to_task', taskId: ctx.model.tasks.find(t => t.id === ctx.lastTaskId!)?.label || ctx.lastTaskId, anchor: 'end' }; }
    ctx.lastTaskId = existing.id;
    return;
  }
  const task: GanttTask = { id: `task_${ctx.taskIndex++}`, label: st.label || '', ...extra } as any;
  (task as any)._so = ++ctx._order;
  addImplicitDeps(ctx, task);
  if (st.isThen && ctx.lastTaskId) { ctx.model.dependencies.push({ from: ctx.lastTaskId, to: task.id }); if (!task.start) task.start = { type: 'relative_to_task', taskId: ctx.model.tasks.find(t => t.id === ctx.lastTaskId!)?.label || ctx.lastTaskId, anchor: 'end' }; }
  ctx.model.tasks.push(task);
  ctx.lastTaskId = task.id;
}

/** Create implicit dependency arrows when start/end references another task.
 *  Resolves anchor chains: if B→A.start and A.start→Z.end, edge goes Z→B. */
function addImplicitDeps(ctx: ParseContext, task: GanttTask): void {
  const refs: { taskId: string; anchor: string }[] = [];
  if (task.start?.type === 'relative_to_task') refs.push({ taskId: task.start.taskId, anchor: task.start.anchor });
  if (task.end?.type === 'relative_to_task') refs.push({ taskId: task.end.taskId, anchor: task.end.anchor });
  for (const ref of refs) {
    let fromTask = findTask(ctx, ref.taskId);
    if (!fromTask || fromTask.id === task.id) continue;
    // Resolve chain: if referencing X's 'start' and X.start is also relative, follow it
    if (ref.anchor === 'start' && fromTask.start?.type === 'relative_to_task') {
      const chainRef = findTask(ctx, fromTask.start.taskId);
      if (chainRef && chainRef.id !== task.id) fromTask = chainRef;
    } else if (ref.anchor === 'end' && fromTask.end?.type === 'relative_to_task') {
      const chainRef = findTask(ctx, fromTask.end.taskId);
      if (chainRef && chainRef.id !== task.id) fromTask = chainRef;
    }
    const exists = ctx.model.dependencies.some(d => d.from === fromTask!.id && d.to === task.id);
    if (!exists) ctx.model.dependencies.push({ from: fromTask!.id, to: task.id });
  }
}

function t_dep(ctx: ParseContext, st: any): void {
  let from = findTask(ctx, st.from), to = findTask(ctx, st.to);
  // Create implicit tasks for undeclared endpoints (default: 1 day, start at peer's end)
  if (!from) {
    from = { id: `task_${ctx.taskIndex++}`, label: st.from, duration: { value: 1, unit: 'day' } } as GanttTask;
    (from as any)._so = ++ctx._order;
    ctx.model.tasks.push(from);
  }
  if (!to) {
    to = { id: `task_${ctx.taskIndex++}`, label: st.to, duration: { value: 1, unit: 'day' } } as GanttTask;
    (to as any)._so = ++ctx._order;
    ctx.model.tasks.push(to);
  }
  const dep: GanttDependency = { from: from.id, to: to.id };
  if (st.arrowStyle === 'dotted') dep.style = 'dotted';
  else if (st.arrowStyle?.startsWith('#')) dep.color = st.arrowStyle;
  ctx.model.dependencies.push(dep);
  // [A] -> [B] also constrains B.start = A.end (if B has no explicit start)
  if (to && from && !to.start) {
    to.start = { type: 'relative_to_task', taskId: from.label || from.aliasId || from.id, anchor: 'end' };
  }
}

function t_ms(ctx: ParseContext, st: any): void {
  const diw = getDaysInWeek(ctx.model.config.closedDays);
  const parsed = parseMilestoneRest(st.rest || '', diw);
  // If a milestone with the same label exists, keep the latest date
  const existing = ctx.model.milestones.find(m => m.label === st.label);
  if (existing) {
    // Merge: keep later date (compare by resolving offsets)
    // Store both; layout will use the max offset
    const ms: any = { id: `milestone_${ctx.msIdx++}`, label: st.label || '', at: parsed.at || { type: 'absolute', date: '' } };
    ms._so = ++ctx._order;
    ctx.model.milestones.push(ms); // add, and later maxDayOffset will pick the largest
    return;
  }
  const ms: any = { id: `milestone_${ctx.msIdx++}`, label: st.label || '', at: parsed.at || { type: 'absolute', date: '' } };
  ms._so = ++ctx._order;
  ctx.model.milestones.push(ms);
}

function t_color(ctx: ParseContext, st: any): void {
  const colors = (st.rest || '').trim();
  // Check for "are named [Label]" in the rest
  const nameMatch = colors.match(/are\s+named\s+\[([^\]]+)\]/);
  const pureColors = nameMatch ? colors.substring(0, nameMatch.index).trim() : colors;
  const c = pureColors.split(/\s*\/\s*/); const bg = c[0] || pureColors;
  const name = nameMatch ? nameMatch[1] : undefined;

  if (st.target === 'task' && st.label) { const t = findTask(ctx, st.label); if (t) t.color = { bg, fg: c[1] || bg }; }
  else if (st.target === 'range') ctx.model.dateRanges.push({ from: { type: 'absolute', date: st.from }, to: { type: 'absolute', date: st.to }, color: bg, name });
  else if (st.target === 'date') ctx.model.dateRanges.push({ from: { type: 'absolute', date: st.date }, to: { type: 'absolute', date: st.date }, color: bg, name });
  else if (st.target === 'today') ctx.model.config.todayColor = bg;
}

function t_comp(ctx: ParseContext, st: any): void { const t = findTask(ctx, st.label); if (t) t.completion = st.percent; }
function t_del(ctx: ParseContext, st: any): void { const t = findTask(ctx, st.label); if (t) t.deleted = true; }

function t_sep(ctx: ParseContext, st: any): void {
  const sep: any = { label: st.label || '' };
  sep._so = ++ctx._order;
  ctx.model.separators.push(sep);
}

// ── Style block handlers ─────────────────────────────────────────────────────
function t_styleBlock(ctx: ParseContext, st: any): void {
  const raw = (st.raw || st.type || '').trim();
  if (!raw) return;
  if (!ctx.model.style) ctx.model.style = {} as any;
  // Detect selector: task, milestone, undone, unstarted, timeline, closed, note, arrow, separator
  const selMatch = raw.match(/^\s*(\w+)\s*\{?\s*$/);
  if (selMatch) {
    const name = selMatch[1].toLowerCase();
    if (name === 'ganttdiagram') { ctx._styleSelector = 'task'; return; }
    const valid = ['task','milestone','arrow','separator','timeline','closed','undone','unstarted','note'];
    if (valid.includes(name)) ctx._styleSelector = name;
  }
}
function t_styleText(ctx: ParseContext, st: any): void {
  const raw = (st.raw || st.text || '').trim();
  if (!raw || !ctx.model.style) return;
  const sel = ctx._styleSelector || 'task';
  if (!ctx.model.style[sel]) ctx.model.style[sel] = {} as any;
  const s = ctx.model.style[sel];
  const m = raw.match(/^\s*(\w+)\s+(.+?)\s*$/);
  if (!m) return;
  const prop = m[1].toLowerCase(), val = m[2].trim();
  if (prop === 'backgroundcolor') s.backgroundColor = val;
  else if (prop === 'linecolor') s.lineColor = val;
  else if (prop === 'fontcolor') s.fontColor = val;
  else if (prop === 'fontname') s.fontName = val;
  else if (prop === 'fontsize') s.fontSize = parseInt(val, 10) || undefined;
  else if (prop === 'fontstyle') s.fontStyle = val;
  else if (prop === 'linestyle') s.lineStyle = val;
  else if (prop === 'linethickness') s.lineThickness = parseFloat(val) || undefined;
  else if (prop === 'margin') s.margin = parseInt(val, 10) || undefined;
  else if (prop === 'padding') s.padding = parseInt(val, 10) || undefined;
}

// Remove old t_style function
// function t_style is replaced by t_styleBlock + t_styleText above

function t_cfg(ctx: ParseContext, st: any): void {
  const raw = (st.raw || '').trim();
  if (/^Project\s+starts\s+(?:on\s+)?(.+)/i.test(raw)) ctx.model.projectStart = { type: 'absolute', date: RegExp.$1!.trim() };
  else if (/^Print\s+between\s+(.+)\s+and\s+(.+)/i.test(raw)) ctx.model.config.printRange = { from: { type: 'absolute', date: RegExp.$1!.trim() }, to: { type: 'absolute', date: RegExp.$2!.trim() } };
  else if (/^projectscale\s+(\w+)/.test(raw)) {
    ctx.model.config.scale = RegExp.$1!.trim() as any;
    if (/\bzoom\s+(\d+)/i.test(raw)) ctx.model.config.zoom = parseInt(RegExp.$1!, 10);
  }
  else if (/^printscale\s+(\w+)/.test(raw)) {
    ctx.model.config.printScale = { unit: RegExp.$1!.trim() };
    // Also parse zoom / week numbering / calendar date from the same line
    if (/\bzoom\s+(\d+)/i.test(raw)) ctx.model.config.zoom = parseInt(RegExp.$1!, 10);
    if (/with\s+week\s+numbering\s+from\s+(-?\d+)/i.test(raw)) { ctx.model.config.printScale.weekNumberingFrom = parseInt(RegExp.$1!, 10); }
    if (/with\s+calendar\s+date/i.test(raw)) { ctx.model.config.printScale.calendarDate = true; }
  }
  else if (/saturday\s+are\s+close/i.test(raw)) { if (!ctx.model.config.closedDays) ctx.model.config.closedDays = []; if (!ctx.model.config.closedDays!.includes(6)) ctx.model.config.closedDays!.push(6); }
  else if (/sunday\s+are\s+close/i.test(raw)) { if (!ctx.model.config.closedDays) ctx.model.config.closedDays = []; if (!ctx.model.config.closedDays!.includes(0)) ctx.model.config.closedDays!.push(0); }
  else if (/friday\s+are\s+close/i.test(raw)) { if (!ctx.model.config.closedDays) ctx.model.config.closedDays = []; if (!ctx.model.config.closedDays!.includes(5)) ctx.model.config.closedDays!.push(5); }
  else if (/^hide\s+footbox/i.test(raw)) ctx.model.config.hideFootbox = true;
  else if (/^hide\s+resources\s+names/i.test(raw)) ctx.model.config.hideResourcesNames = true;
  else if (/^hide\s+resources\s+footbox/i.test(raw)) ctx.model.config.hideResourcesFootbox = true;
  else if (/^title\s+(.+)/i.test(raw)) ctx.model.title = RegExp.$1!.trim();
  else if (/^language\s+(\S+)/i.test(raw)) ctx.model.config.language = RegExp.$1!.trim();
  else if (/^Label\s+on\s+(.+)/i.test(raw)) { const p = RegExp.$1!.trim(); if (p.includes('first')) ctx.model.config.labelPosition = 'first'; else if (p.includes('last')) ctx.model.config.labelPosition = 'last'; if (p.includes('left')) ctx.model.config.labelAlignment = 'left'; else if (p.includes('right')) ctx.model.config.labelAlignment = 'right'; }
  // Zoom: projectscale monthly zoom 3 / printscale weekly zoom 4
  else if (/(?:projectscale|printscale)\s+.+\bzoom\s+(\d+)/i.test(raw)) ctx.model.config.zoom = parseInt(RegExp.$1!, 10);
  // Week numbering: printscale weekly with week numbering from N
  else if (/with\s+week\s+numbering\s+from\s+(-?\d+)/i.test(raw)) { if (!ctx.model.config.printScale) ctx.model.config.printScale = {}; ctx.model.config.printScale.weekNumberingFrom = parseInt(RegExp.$1!, 10); }
  // Calendar date: printscale weekly with calendar date
  else if (/with\s+calendar\s+date/i.test(raw)) { if (!ctx.model.config.printScale) ctx.model.config.printScale = {}; ctx.model.config.printScale.calendarDate = true; }
  // Closed dates: YYYY-MM-DD is closed / YYYY-MM-DD to YYYY-MM-DD is closed
  else if (/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+to\s+(\d{4}[-\/]\d{2}[-\/]\d{2})\s+is\s+closed/i.test(raw)) { if (!ctx.model.config.closedDates) ctx.model.config.closedDates = []; ctx.model.config.closedDates.push({ from: { type: 'absolute', date: RegExp.$1!.trim() }, to: { type: 'absolute', date: RegExp.$2!.trim() } }); }
  else if (/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+is\s+closed/i.test(raw)) { if (!ctx.model.config.closedDates) ctx.model.config.closedDates = []; const d = RegExp.$1!.trim(); ctx.model.config.closedDates.push({ from: { type: 'absolute', date: d }, to: { type: 'absolute', date: d } }); }
  // Open dates (override closed): YYYY-MM-DD is open/opened
  else if (/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+is\s+(?:open|opened)/i.test(raw)) { if (!ctx.model.config.openDates) ctx.model.config.openDates = []; ctx.model.config.openDates.push({ date: { type: 'absolute', date: RegExp.$1!.trim() } }); }
  // Weeks config: weeks starts on Sunday and must have at least N days
  else if (/weeks?\s+starts?\s+on\s+(\w+)/i.test(raw)) { const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday']; const idx = days.indexOf(RegExp.$1!.toLowerCase()); if (idx >= 0) ctx.model.config.weekStartsOn = idx;
    // Also extract "must have at least N days" from the same line
    const minDaysMatch = raw.match(/must\s+have\s+at\s+least\s+(\d+)\s+days/i);
    if (minDaysMatch) ctx.model.config.weekMinDays = parseInt(minDaysMatch[1], 10);
  }
  else if (/must\s+have\s+at\s+least\s+(\d+)\s+days/i.test(raw)) ctx.model.config.weekMinDays = parseInt(RegExp.$1!, 10);
  // header / footer / caption
  else if (/^header\s+(.+)/i.test(raw)) ctx.model.header = RegExp.$1!.trim();
  else if (/^footer\s+(.+)/i.test(raw)) ctx.model.footer = RegExp.$1!.trim();
  else if (/^caption\s+(.+)/i.test(raw)) ctx.model.caption = RegExp.$1!.trim();
  // "are named [Label]" for date ranges - handled in t_color
}

function t_resOff(ctx: ParseContext, st: any): void {
  const name = (st.name || '').trim();
  const rest = (st.rest || '').trim();
  // Parse YYYY-MM-DD to YYYY-MM-DD
  const m = rest.match(/(\d{4}[-\/]\d{2}[-\/]\d{2})\s+to\s+(\d{4}[-\/]\d{2}[-\/]\d{2})/);
  if (m) {
    const res: any = { name, offDates: [{ from: { type: 'absolute', date: m[1] }, to: { type: 'absolute', date: m[2] } }] };
    ctx.model.resources.push(res);
  }
}

function t_generic(ctx: ParseContext, st: any): void {
  const raw = String(st.raw || st.text || '').trim(); if (!raw) return;
  let m: any;

  // Fallback: gantt config lines misclassified by PEG (e.g. hyphens in content)
  if (/^(printscale|projectscale|Project\s+starts|Print\s+between|saturday\s+are\s+close|sunday\s+are\s+close|friday\s+are\s+close|hide\s+footbox|hide\s+resources|title\s+|language\s+|Label\s+on|header\s+|footer\s+|caption\s+|weeks?\s+starts?\s+on|must\s+have\s+at\s+least)/i.test(raw)) {
    t_cfg(ctx, { raw });
    return;
  }

  // then [Task] requires ... (implicit dependency chain) — case-insensitive
  if (/^then\s+\[([^\]]+)\](.*)/i.test(raw)) {
    const label = RegExp.$1!.trim(); const rest = RegExp.$2!.trim();
    const diw = getDaysInWeek(ctx.model.config.closedDays);
    const extra = parseTaskRest(rest, diw);
    const existing = findTask(ctx, label);
    if (existing) {
      Object.assign(existing, extra);
      if (ctx.lastTaskId) { ctx.model.dependencies.push({ from: ctx.lastTaskId, to: existing.id }); if (!existing.start) existing.start = { type: 'relative_to_task', taskId: ctx.model.tasks.find(t => t.id === ctx.lastTaskId!)?.label || ctx.lastTaskId, anchor: 'end' }; }
      ctx.lastTaskId = existing.id; return;
    }
    const task: any = { id: `task_${ctx.taskIndex++}`, label, ...extra };
    task._so = ++ctx._order;
    addImplicitDeps(ctx, task);
    if (ctx.lastTaskId) { ctx.model.dependencies.push({ from: ctx.lastTaskId, to: task.id }); if (!task.start) task.start = { type: 'relative_to_task', taskId: ctx.model.tasks.find(t => t.id === ctx.lastTaskId!)?.label || ctx.lastTaskId, anchor: 'end' }; }
    ctx.model.tasks.push(task); ctx.lastTaskId = task.id; return;
  }

  // Separator just at/after/before [Task]'s start/end (positioned separator)
  m = raw.match(/^Separator\s+just\s+(.+)/i);
  if (m) {
    const rest = m[1].trim();
    // Parse: at [Task]'s end  /  2 days after [Task]'s end  /  2 days before [Task]'s start
    const atMatch = rest.match(/^at\s+\[([^\]]+)\]\'s\s+(start|end)/);
    const offsetMatch = rest.match(/^(\d+)\s+days?\s+(after|before)\s+\[([^\]]+)\]\'s\s+(start|end)/);
    if (offsetMatch) {
      const offset = parseInt(offsetMatch[1]) * (offsetMatch[2] === 'before' ? -1 : 1);
      ctx.model.separators.push({ label: '', at: { type: 'relative_to_task', taskId: offsetMatch[3], anchor: offsetMatch[4] as any, offsetDays: offset } });
    } else if (atMatch) {
      ctx.model.separators.push({ label: '', at: { type: 'relative_to_task', taskId: atMatch[1], anchor: atMatch[2] as any } });
    }
    return;
  }

  // [Task] occurs from [M1] to [M2]
  m = raw.match(/^\[([^\]]+)\]\s+occurs\s+from\s+\[([^\]]+)\]\s+to\s+\[([^\]]+)\]/);
  if (m) {
    const task: GanttTask = { id: `task_${ctx.taskIndex++}`, label: m[1],
      start: { type: 'relative_to_task', taskId: m[2], anchor: 'end' },
      end: { type: 'relative_to_task', taskId: m[3], anchor: 'end' } };
    ctx.model.tasks.push(task); ctx.lastTaskId = task.id; return;
  }

  // [Task] pauses on YYYY-MM-DD / monday
  m = raw.match(/^\[([^\]]+)\]\s+pauses\s+on\s+(.+)/);
  if (m) {
    const t = findTask(ctx, m[1]);
    if (t) { if (!t.pausedDates) t.pausedDates = []; t.pausedDates.push({ type: 'absolute', date: m[2].trim() }); }
    return;
  }

  // Note handling: note bottom ... end note
  if (/^note\s+bottom/i.test(raw)) { ctx.noteBuf = { lines: [], position: 'bottom' }; return; }
  if (/^end\s+note/i.test(raw)) { if (ctx.noteBuf?.lines.length) { ctx.model.notes.push({ lines: [...ctx.noteBuf.lines], position: ctx.noteBuf.position }); ctx.noteBuf = null; } return; }
  // Inside note buffer, catch all text lines
  if (ctx.noteBuf) { ctx.noteBuf.lines.push(raw); return; }

  // Legend handling: legend ... end legend
  if (/^legend\b/i.test(raw)) { ctx._legendLines = []; return; }
  if (/^end\s+legend\b/i.test(raw)) { if (ctx._legendLines?.length) ctx.model.legend = { lines: [...ctx._legendLines] }; ctx._legendLines = undefined; return; }
  if (ctx._legendLines) { ctx._legendLines.push(raw); return; }
  m = raw.match(/^\[(.+?)\]\s*-+\s*>\s*\[(.+?)\]\s*$/); if (m) { let f = findTask(ctx, m[1]), t = findTask(ctx, m[2]); if (!f) { f = { id: `task_${ctx.taskIndex++}`, label: m[1], duration: { value: 1, unit: 'day' } } as GanttTask; (f as any)._so = ++ctx._order; ctx.model.tasks.push(f); } if (!t) { t = { id: `task_${ctx.taskIndex++}`, label: m[2], duration: { value: 1, unit: 'day' } } as GanttTask; (t as any)._so = ++ctx._order; ctx.model.tasks.push(t); } ctx.model.dependencies.push({ from: f.id, to: t.id }); if (!t.start) t.start = { type: 'relative_to_task', taskId: f.label || f.aliasId || f.id, anchor: 'end' }; return; }
  // Date coloring: YYYY-MM-DD is colored in Color
  m = raw.match(/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+is\s+colored\s+in\s+(.+)/i); if (m) { ctx.model.dateRanges.push({ from: { type: 'absolute', date: m[1].trim() }, to: { type: 'absolute', date: m[1].trim() }, color: m[2].trim() }); return; }
  // Date range coloring: YYYY-MM-DD to YYYY-MM-DD are colored in Color
  m = raw.match(/^(\d{4}[-\/]\d{2}[-\/]\d{2})\s+to\s+(\d{4}[-\/]\d{2}[-\/]\d{2})\s+are\s+colored\s+in\s+(.+)/i); if (m) { ctx.model.dateRanges.push({ from: { type: 'absolute', date: m[1].trim() }, to: { type: 'absolute', date: m[2].trim() }, color: m[3].trim() }); return; }
  // Standalone coloring: [Task] is colored in Color/Color
  m = raw.match(/^\[(.+?)\]\s+is\s+colored\s+in\s+(.+)/i); if (m) { const t = findTask(ctx, m[1]); if (t) { const parts = m[2].trim().split(/\s*\/\s*/); t.color = { bg: parts[0], fg: parts[1] || parts[0] }; } return; }
  m = raw.match(/^\[(.+?)\]\s+is\s+(\d+)%\s+complete/); if (m) { const t = findTask(ctx, m[1]); if (t) t.completion = parseInt(m[2]); return; }
  m = raw.match(/^\[(.+?)\]\s+happens\s+(.+)/); if (m) { const diw = getDaysInWeek(ctx.model.config.closedDays); const p = parseMilestoneRest(m[2], diw); ctx.model.milestones.push({ id: `milestone_${ctx.msIdx++}`, label: m[1], at: p.at || { type: 'absolute', date: m[2].trim() } }); return; }
}

function findTask(ctx: ParseContext, label: string): GanttTask | undefined {
  for (const t of ctx.model.tasks) { if (t.label === label || t.aliasId === label || t.alias === label) return t; }
  return undefined;
}
