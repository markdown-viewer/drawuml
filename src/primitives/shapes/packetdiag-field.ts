/**
 * Packetdiag field shape renderer.
 *
 * Each field = 1 rectangle (mxCell with fillColor/strokeColor) + 1 label (text mxCell).
 * All colors follow theme defaults; user per-field color/textColor overrides take priority.
 * Reserved fields (parenthesized label) render with dashed border.
 */

import { Renderer } from '../renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import type { ContentBox } from '../../shared/content-types.ts';

class PacketdiagFieldRenderer extends Renderer {
  private _label: string;
  private _fillColor: string;
  private _textColor: string;
  private _rotate: number;
  private _isReserved: boolean;

  constructor(
    id: string,
    opts: {
      label: string;
      color?: string;
      textColor?: string;
      rotate?: number;
      isReserved?: boolean;
      border?: string;
      theme?: import('../../shared/theme.ts').Theme;
    },
  ) {
    super(id, opts.theme);
    this._label = opts.label || '';
    this._fillColor = opts.color || this.theme.defaultFill;
    this._textColor = opts.textColor || this.theme.fontColor;
    this._rotate = opts.rotate ?? 0;
    this._isReserved = opts.isReserved ?? false;
  }

  protected doMeasure(): { width: number; height: number } {
    // Dimensions are determined by layout, not content.
    return { width: 0, height: 0 };
  }

  render(box: ContentBox): string[] {
    const t = this.theme;
    const cells: string[] = [];

    // Reserved fields get dashed border
    const strokeExtra = this._isReserved ? 'dashed=1;' : '';

    // 1. Rectangle background (minimal style)
    cells.push(mxVertex({
      id: this.id,
      value: '',
      style: `rounded=0;whiteSpace=wrap;html=1;fillColor=${this._fillColor};strokeColor=${t.colorDark};strokeWidth=${t.strokeWidth};${strokeExtra}`,
      parent: this.parentId || '1',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }));

    // 2. Label text
    // Rotated labels are vertical (rotation=-90 in DrawIO); default is horizontal centre
    const rotStyle = this._rotate === 270 ? 'rotation=-90;' : '';

    cells.push(mxVertex({
      id: `${this.id}_label`,
      value: this._label,
      style: `text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;fontSize=${t.fontSize};fontFamily=${t.fontFamily};fontColor=${this._textColor};${rotStyle}`,
      parent: this.parentId || '1',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }));

    return cells;
  }
}

/** Register packetdiag-field renderer into global registry. */
export function registerPacketdiagFieldRenderer(): void {
  registerRenderer('packetdiag-field', (desc: RenderDescriptor & {
    label?: string;
    color?: string;
    textColor?: string;
    rotate?: number;
    isReserved?: boolean;
    border?: string;
  }) => {
    return new PacketdiagFieldRenderer(desc.id, {
      label: desc.label || '',
      color: desc.color,
      textColor: desc.textColor,
      rotate: desc.rotate,
      isReserved: desc.isReserved,
      border: desc.border,
      theme: desc.theme,
    });
  });
}
