/**
 * Activity node primitive — renders legacy activity diagram boxes
 * as rounded rectangles with centered text.
 */

import { mxVertex } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import { measureText } from '@markdown-viewer/text-measure';
import { creoleInline } from '../shared/creole-inline.ts';
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, DEFAULT_FILL, COLOR_DARK } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PADDING_H = 20;    // horizontal padding inside the box
const PADDING_V = 10;    // vertical padding inside the box
const ARC_SIZE = 25;     // rounded corner arc size (PlantUML default for activities)

// Extra padding for octagon shape to prevent text from being clipped by cut corners
const OCTAGON_EXTRA_H = 14;
const OCTAGON_EXTRA_V = 6;

const ACTIVITY_STYLE = 'rounded=1;whiteSpace=wrap;html=1;'
  + `fillColor=${DEFAULT_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;`
  + `fontSize=${DEFAULT_FONT_SIZE};fontColor=${COLOR_DARK};align=center;verticalAlign=middle;`
  + `arcSize=${ARC_SIZE};`;

const OCTAGON_STYLE = 'shape=mxgraph.basic.octagon;whiteSpace=wrap;html=1;'
  + `fillColor=${DEFAULT_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;`
  + `fontSize=${DEFAULT_FONT_SIZE};fontColor=${COLOR_DARK};align=center;verticalAlign=middle;`;

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class ActivityNodeRenderer extends Renderer {
  private desc: RenderDescriptor;
  private labelHtml: string;
  private isOctagon: boolean;

  constructor(desc: RenderDescriptor) {
    super(desc.id);
    this.desc = desc;
    this.labelHtml = creoleInline(desc.label || '');
    this.isOctagon = desc.activityShape === 'octagon';
  }

  protected doMeasure() {
    const meas = measureText(this.labelHtml, DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
    const padH = PADDING_H + (this.isOctagon ? OCTAGON_EXTRA_H : 0);
    const padV = PADDING_V + (this.isOctagon ? OCTAGON_EXTRA_V : 0);
    return {
      width: Math.max(Math.ceil(meas.width) + padH * 2, 80),
      height: Math.max(Math.ceil(meas.height) + padV * 2, 30),
    };
  }

  render(box: ContentBox) {
    const { width, height } = this.doMeasure();
    const x = box.x + Math.round((box.width - width) / 2);
    const y = box.y + Math.round((box.height - height) / 2);

    return [mxVertex({
      id: this.desc.id,
      value: this.labelHtml,
      style: this.isOctagon ? OCTAGON_STYLE : ACTIVITY_STYLE,
      parent: this.parentId || '1',
      x, y, width, height,
    })];
  }
}

/** Register activity-node renderer into global registry. */
export function registerActivityNodeRenderer(): void {
  registerRenderer('activity', (desc: RenderDescriptor) => new ActivityNodeRenderer(desc));
}
