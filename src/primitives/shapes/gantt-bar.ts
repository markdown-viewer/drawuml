/**
 * Gantt bar shape renderer.
 *
 * Renders a task bar as a rounded rectangle with optional progress fill.
 * Used for both task bars and colored date ranges.
 */

import { Renderer } from '../renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import { TextBlock } from '../../shared/text-block.ts';

class GanttBarRenderer extends Renderer {
  private _label: string;
  private _labelHtml: string;    // Creole-processed HTML label
  private _completion: number;
  private _undoneColor: string;   // bar background (undone portion)
  private _taskColor: string;     // completed progress fill
  private _strokeColor: string;

  constructor(desc: RenderDescriptor & { completion?: number; strokeColor?: string; undoneColor?: string }) {
    super(desc.id, desc.theme);
    this._label = desc.label || '';
    this._completion = desc.completion ?? 0;
    // task.color.bg is the completed-color; undone is the bar background
    this._taskColor = desc.color || this.theme.defaultFill;
    this._undoneColor = (desc as any).undoneColor || this._taskColor;
    this._strokeColor = desc.strokeColor || this.theme.colorDark;
    // Process label through Creole pipeline for HTML rendering
    const font = { size: this.theme.fontSize, family: this.theme.fontFamily };
    this._labelHtml = this._label ? TextBlock.inline(this._label, font).html : '';
  }

  doMeasure(): { width: number; height: number } {
    // Width is determined by layout (date range), not by content.
    const font = { size: this.theme.fontSize, family: this.theme.fontFamily };
    const labelW = this._label ? TextBlock.inline(this._label, font).width + this.theme.padS : 0;
    return { width: Math.max(labelW, this.theme.sizeL), height: this.theme.titleBarH };
  }

  render(box: ContentBox): string[] {
    const { x, y, width, height } = box;
    const arcSize = Math.round(this.theme.fontSize / 2); // 6 @12
    const insetH = this.theme.strokeWidth;               // border inset (1px)
    const insetW = this.theme.boldStrokeWidth;            // 2 × insetH
    const font = { size: this.theme.fontSize, family: this.theme.fontFamily };
    const padX = this.theme.padS; // label padding (10px)
    const labelW = this._label ? TextBlock.inline(this._label, font).width + padX : 0;
    // Label fits inside bar?
    const labelFits = labelW <= width;
    // Label x: inside bar (left edge + 4) or outside bar (right edge + edgeGap)
    const labelX = labelFits ? Math.round(x) : Math.round(x + width + this.theme.edgeGap);
    // Label width: when inside, fill bar; when outside, use natural width
    const labelBoxW = labelFits ? Math.round(width) : Math.round(labelW);

    const cells: string[] = [];

    // ═══ Three-layer approach ═══
    // Layer 1: Border shape — filled with strokeColor, rounded, full size
    const borderId = `${this.id}_border`;
    cells.push(mxVertex({
      id: borderId,
      parent: this.parentId || '1',
      value: '',
      style: `rounded=1;absoluteArcSize=1;arcSize=${arcSize};fillColor=${this._strokeColor};strokeColor=none;html=1;`,
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    }));

    // Layer 2: Background shape — filled with undoneColor, rounded, inset by strokeWidth
    const bgId = `${this.id}_bg`;
    const barBg = this._completion === 100 ? this._taskColor : this._undoneColor;
    cells.push(mxVertex({
      id: bgId,
      parent: borderId,
      value: '',
      style: `rounded=1;absoluteArcSize=1;arcSize=${arcSize};fillColor=${barBg};strokeColor=none;`,
      x: insetH, y: insetH,
      width: Math.round(width) - insetW,
      height: Math.round(height) - insetW,
    }));

    // Layer 3: Progress shape — same rounding as parent, inside background
    if (this._completion > 0) {
      cells.push(mxVertex({
        id: `${this.id}_progress`,
        parent: bgId,
        value: '',
        style: `rounded=1;absoluteArcSize=1;arcSize=${arcSize};fillColor=${this._taskColor};strokeColor=none;`,
        x: 0, y: 0,
        width: Math.max(arcSize, Math.round((width - insetW) * this._completion / 100)),
        height: Math.round(height) - insetW,
      }));
    }

    // Label — inside bar if fits, else outside to the right
    if (this._label) {
      cells.push(mxVertex({
        id: `${this.id}_label`,
        parent: this.parentId || '1',
        value: this._labelHtml,
        style: [
          `text`, `html=1`, `fillColor=none`, `strokeColor=none`,
          `fontSize=${this.theme.fontSize}`,
          `fontFamily=${this.theme.fontFamily}`,
          `fontColor=${this.theme.fontColor}`,
          `align=left`, `verticalAlign=middle`,
          `spacingLeft=${this.theme.edgeGap}`, `overflow=visible`,
        ].join(';') + ';',
        x: labelX,
        y: Math.round(y),
        width: labelBoxW,
        height: Math.round(height),
      }));
    }

    return cells;
  }

  /** Darken a hex color by a ratio (simple implementation). */
  private _darken(color: string, ratio: number): string {
    if (!color || !color.startsWith('#')) return color;
    const hex = color.replace('#', '');
    if (hex.length !== 6) return color;
    const r = Math.max(0, Math.round(parseInt(hex.substring(0, 2), 16) * (1 - ratio)));
    const g = Math.max(0, Math.round(parseInt(hex.substring(2, 4), 16) * (1 - ratio)));
    const b = Math.max(0, Math.round(parseInt(hex.substring(4, 6), 16) * (1 - ratio)));
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
}

/** Register gantt-bar renderer into global registry. */
export function registerGanttBarRenderer(): void {
  registerRenderer('gantt-bar', (desc: RenderDescriptor) => new GanttBarRenderer(desc as any));
}
