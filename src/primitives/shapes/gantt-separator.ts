/**
 * Gantt separator shape renderer — two horizontal lines with label between.
 */
import { Renderer } from '../renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import { TextBlock } from '../../shared/text-block.ts';

class GanttSeparatorRenderer extends Renderer {
  private _label: string;

  constructor(desc: RenderDescriptor) {
    super(desc.id, desc.theme);
    this._label = desc.label || '';
  }

  doMeasure(): { width: number; height: number } {
    return { width: this.theme.sizeL, height: this.theme.fontSize + 16 };
  }

  render(box: ContentBox): string[] {
    const { x, y, width } = box;
    const cy = Math.round(y + box.height / 2);
    const color = this.theme.colorDark;
    const lh = this.theme.boldStrokeWidth;
    const cells: string[] = [];
    const font = { size: this.theme.fontSize - 2, family: this.theme.fontFamily };
    const textW = this._label ? TextBlock.inline(this._label, font).width + this.theme.padL : 0;
    const midX = Math.round(x + width / 2);
    const halfGap = Math.round(textW / 2);

    // Left line
    const leftW = midX - halfGap - x;
    if (leftW > 0) {
      cells.push(mxVertex({
        id: `${this.id}_lineL`, parent: this.parentId || '1', value: '',
        style: `shape=rect;fillColor=${color};strokeColor=none;html=1;`,
        x: Math.round(x), y: cy - Math.round(lh / 2),
        width: leftW, height: lh,
      }));
    }

    // Right line
    const rightX = midX + halfGap;
    const rightW = x + width - rightX;
    if (rightW > 0) {
      cells.push(mxVertex({
        id: `${this.id}_lineR`, parent: this.parentId || '1', value: '',
        style: `shape=rect;fillColor=${color};strokeColor=none;html=1;`,
        x: rightX, y: cy - Math.round(lh / 2),
        width: rightW, height: lh,
      }));
    }

    // Label centered
    if (this._label) {
      cells.push(mxVertex({
        id: `${this.id}_label`, parent: this.parentId || '1', value: this._label,
        style: `shape=rect;fillColor=none;strokeColor=none;html=1;fontSize=${this.theme.fontSize - 2};fontFamily=${this.theme.fontFamily};fontColor=${this.theme.fontColor};fontStyle=1;align=center;verticalAlign=middle;`,
        x: Math.round(midX - halfGap), y: Math.round(y),
        width: Math.round(textW), height: Math.round(box.height),
      }));
    }

    return cells;
  }
}

export function registerGanttSeparatorRenderer(): void {
  registerRenderer('gantt-separator', (desc: RenderDescriptor) => new GanttSeparatorRenderer(desc));
}
