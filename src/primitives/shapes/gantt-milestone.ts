/**
 * Gantt milestone shape renderer.
 *
 * Renders a diamond-shaped milestone marker with label.
 */

import { Renderer } from '../renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import { TextBlock } from '../../shared/text-block.ts';

class GanttMilestoneRenderer extends Renderer {
  private _label: string;
  private _color: string;
  private _strokeColor: string;

  constructor(desc: RenderDescriptor & { strokeColor?: string }) {
    super(desc.id, desc.theme);
    this._label = desc.label || '';
    this._color = desc.color || desc.theme.defaultFill;
    this._strokeColor = desc.strokeColor || desc.theme.colorDark;
  }

  doMeasure(): { width: number; height: number } {
    const size = Math.round((this.theme.fontSize + 8) * 2 / 3);
    return { width: size, height: size };
  }

  render(box: ContentBox): string[] {
    const { x, y } = box;
    const size = Math.max(box.width, box.height);
    const cx = Math.round(x + size / 2);
    const cy = Math.round(y + size / 2);

    const cells: string[] = [];

    // Solid diamond marker
    cells.push(mxVertex({
      id: `${this.id}_diamond`,
      parent: this.parentId || '1',
      value: '',
      style: `shape=rhombus;fillColor=${this._color};strokeColor=${this._strokeColor};strokeWidth=${this.theme.strokeWidth};html=1;`,
      x: cx - Math.round(size / 2),
      y: cy - Math.round(size / 2),
      width: Math.round(size),
      height: Math.round(size),
    }));

    // Label to the RIGHT of the diamond, vertically centered
    if (this._label) {
      const font = { size: this.theme.fontSize - 2, family: this.theme.fontFamily };
      const labelW = TextBlock.inline(this._label, font).width + this.theme.padS;
      cells.push(mxVertex({
        id: `${this.id}_label`,
        parent: this.parentId || '1',
        value: this._label,
        style: `text;html=1;fillColor=none;strokeColor=none;fontSize=${this.theme.fontSize - 2};fontFamily=${this.theme.fontFamily};fontColor=${this.theme.fontColor};align=left;verticalAlign=middle;`,
        x: cx + Math.round(size / 2) + 4,
        y: cy - Math.round((this.theme.fontSize) / 2),
        width: Math.round(labelW),
        height: this.theme.fontSize + 4,
      }));
    }

    return cells;
  }
}

/** Register gantt-milestone renderer into global registry. */
export function registerGanttMilestoneRenderer(): void {
  registerRenderer('gantt-milestone', (desc: RenderDescriptor) => new GanttMilestoneRenderer(desc as any));
}
