/**
 * Box renderer — generic group background box.
 * Used for participant group backgrounds in sequence diagrams,
 * potentially reusable for other grouping constructs.
 *
 * Box dimensions are determined externally by the grouped elements'
 * positions, so measure() returns { 0, 0 }.
 */

import { Content } from '../shared/content.ts';
import { mxVertex } from '../shared/xml-utils.ts';
import { normalizeColor, darkenColor } from '../shared/color-utils.ts';
import { Renderer } from './renderer.ts';
import { LEGEND_FILL, LABEL_FONT_SIZE } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';

export interface BoxRendererOpts {
  label?: string;
  color?: string;
  labelHeight?: number;
}

class BoxRenderer extends Renderer {
  private htmlLabel: string;
  private fillColor: string;
  private strokeColor: string;
  private labelHeight: number;

  constructor(id: string, opts?: BoxRendererOpts) {
    super(id);
    const fill = opts?.color ? normalizeColor(opts.color) : LEGEND_FILL;
    this.fillColor = fill;
    this.strokeColor = darkenColor(fill);
    this.htmlLabel = opts?.label ? Content.inline(opts.label).html : '';
    this.labelHeight = opts?.labelHeight ?? 20;
  }

  /** Box dimensions are determined externally. */
  protected doMeasure() {
    return { width: 0, height: 0 };
  }

  render(box: ContentBox) {
    const cells: string[] = [];
    const boxStyle = `rounded=1;absoluteArcSize=1;arcSize=5;fillColor=${this.fillColor};strokeColor=${this.strokeColor};strokeWidth=0.5;dashed=1;dashPattern=5 5;`;
    cells.push(mxVertex({
      id: this.id, value: '', style: boxStyle,
      x: box.x, y: box.y, width: box.width, height: box.height,
    }));
    if (this.htmlLabel) {
      const labelStyle = `text;html=1;align=center;verticalAlign=bottom;fontSize=${LABEL_FONT_SIZE};fontStyle=1;`;
      cells.push(mxVertex({
        id: this.id + '_label', value: this.htmlLabel, style: labelStyle,
        x: box.x, y: box.y, width: box.width, height: this.labelHeight,
      }));
    }
    return cells;
  }
}

/** Register box renderer into global registry. */
export function registerBoxRenderer(): void {
  registerRenderer('box', (desc: RenderDescriptor) => {
    return new BoxRenderer(desc.id, {
      label: desc.label,
      color: desc.color,
      labelHeight: desc.fixedHeight,
    });
  });
}
