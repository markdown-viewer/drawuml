/**
 * Gantt chart semantic model.
 *
 * Represents the parsed structure of a @startgantt ... @endgantt diagram.
 * All date expressions are normalized to GanttDateExpr for layout resolution.
 */

// ── Date expressions ─────────────────────────────────────────────────────────

export type GanttDateExpr =
  | { type: 'absolute'; date: string }                                    // "2024-01-15"
  | { type: 'absolute_at'; date: string }                                 // "at 2024-01-15" (same, marker)
  | { type: 'relative_to_task'; taskId: string; anchor: 'start' | 'end'; offsetDays?: number; workingDays?: boolean }
  | { type: 'offset_from_start'; days: number }                           // D+14
  | { type: 'today' }
  | { type: 'date_function'; fn: string; args: any[] };

export interface GanttDuration {
  value: number;
  unit: 'day' | 'week' | 'month' | 'year';
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export interface GanttTask {
  id: string;
  label: string;
  alias?: string;
  /** Resolved alias ID used for references (e.g. [T1] in `as [T1]`). */
  aliasId?: string;
  start?: GanttDateExpr;
  end?: GanttDateExpr;
  duration?: GanttDuration;
  completion?: number;         // 0-100
  color?: { bg: string; fg: string };
  resources?: GanttResourceRef[];
  row?: number;                // assigned by layout
  sameRowAsId?: string;        // for "displays on same row as"
  deleted?: boolean;
  pausedDates?: GanttDateExpr[];  // pause dates
  url?: string;                // hyperlink
  /** Inline arrow style from "with blue dotted link" */
  inlineArrowStyle?: { color?: string; style?: 'dotted' | 'dashed' | 'bold' };
}

export interface GanttResourceRef {
  name: string;
  load?: number;  // percentage 0-100
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface GanttDependency {
  from: string;
  to: string;
  color?: string;
  style?: 'dotted' | 'dashed' | 'bold';
}

// ── Milestones ───────────────────────────────────────────────────────────────

export interface GanttMilestone {
  id: string;
  label: string;
  at: GanttDateExpr;
  color?: { bg: string; fg: string };
  row?: number;
  sameRowAsId?: string;
}

// ── Separators ───────────────────────────────────────────────────────────────

export interface GanttSeparator {
  label: string;
  at?: GanttDateExpr;   // for "Separator just at ..."
  atFromEnd?: boolean;  // flag for end-anchored Separator
}

// ── Date ranges ──────────────────────────────────────────────────────────────

export interface GanttDateRange {
  from: GanttDateExpr;
  to: GanttDateExpr;
  color?: string;
  name?: string;        // for "are named [Label]"
}

// ── Notes ────────────────────────────────────────────────────────────────────

export interface GanttNote {
  taskId?: string;       // attached to task, or undefined for diagram-level
  position?: 'bottom' | 'left';
  lines: string[];
}

// ── Resources (diagram-level) ────────────────────────────────────────────────

export interface GanttResource {
  name: string;
  offDates?: { from: GanttDateExpr; to: GanttDateExpr }[];
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface GanttConfig {
  scale?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  zoom?: number;
  printScale?: { unit: string; weekNumberingFrom?: number; calendarDate?: boolean };
  printRange?: { from: GanttDateExpr; to: GanttDateExpr };
  hideFootbox?: boolean;
  hideResourcesNames?: boolean;
  hideResourcesFootbox?: boolean;
  language?: string;
  closedDays?: number[];                  // 0=Sun, 1=Mon, ... 6=Sat
  closedDates?: { from: GanttDateExpr; to: GanttDateExpr }[];
  openDates?: { date: GanttDateExpr }[];
  weekStartsOn?: number;
  weekMinDays?: number;
  labelPosition?: 'first' | 'last';
  labelAlignment?: 'left' | 'right';
  todayColor?: string;
}

// ── Style (from <style> block) ──────────────────────────────────────────────

export interface GanttElementStyle {
  fontName?: string;
  fontColor?: string;
  fontSize?: number;
  fontStyle?: string;
  backgroundColor?: string;
  lineColor?: string;
  margin?: number;
  padding?: number;
}

export interface GanttStyle {
  task?: GanttElementStyle;
  milestone?: GanttElementStyle;
  arrow?: GanttElementStyle & { lineStyle?: string; lineThickness?: number };
  separator?: GanttElementStyle & { lineStyle?: string; lineThickness?: number };
  timeline?: GanttElementStyle;
  closed?: GanttElementStyle;
  undone?: GanttElementStyle;
  unstarted?: GanttElementStyle;
  note?: GanttElementStyle;
}

// ── Top-level model ──────────────────────────────────────────────────────────

export interface GanttModel {
  projectStart?: GanttDateExpr;
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  milestones: GanttMilestone[];
  separators: GanttSeparator[];
  dateRanges: GanttDateRange[];
  notes: GanttNote[];
  resources: GanttResource[];
  config: GanttConfig;
  title?: string;
  titleHtml?: string;
  header?: string;
  footer?: string;
  legend?: { lines: string[] };
  caption?: string;
  style?: GanttStyle;
}
