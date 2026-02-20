/**
 * Circle node primitive — sizing and rendering for circle-stereotype entities.
 * PlantUML renders these as small filled circles with a text label below.
 */

import { measureText } from '@markdown-viewer/text-measure';
import { mxVertex } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import { Content } from '../shared/content.ts';
import { DEFAULT_FONT_FAMILY, TITLE_FONT_SIZE, DEFAULT_FILL, COLOR_DARK } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';
import type { SemanticNode } from '../model/class-model.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CIRCLE_DIAMETER = 16;    // PlantUML: rx=8, ry=8
const CIRCLE_TEXT_GAP = 16;    // gap between circle and text below
const CIRCLE_TEXT_H = 18;      // text line height below circle
const PADDING_X = 40;          // left + right horizontal padding

const CIRCLE_STYLE = 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;'
  + `fillColor=${DEFAULT_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;`
  + `fontSize=${TITLE_FONT_SIZE};fontColor=${COLOR_DARK};`
  + 'verticalLabelPosition=bottom;labelPosition=center;verticalAlign=top;align=center;';

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class CircleNodeRenderer extends Renderer {
  private node: { id: string; label: string };
  private labelHtml: string;
  private textWidth: number;

  constructor(node: { id: string; label: string }) {
    super(node.id);
    this.node = node;
    // Convert raw Creole label to HTML inside the renderer
    this.labelHtml = Content.inline(node.label).html;
    // Measure text width for labelWidth (prevent wrapping under the circle)
    const meas = measureText(this.labelHtml, TITLE_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
    this.textWidth = Math.ceil(meas.width);
  }

  protected doMeasure() {
    const width = Math.max(this.textWidth + PADDING_X, CIRCLE_DIAMETER + PADDING_X);
    const height = CIRCLE_DIAMETER + CIRCLE_TEXT_GAP + CIRCLE_TEXT_H;
    return { width, height };
  }

  render(box: ContentBox) {
    const cw = CIRCLE_DIAMETER;
    const ch = CIRCLE_DIAMETER;
    const cx = box.x + Math.round((box.width - cw) / 2);
    const cy = box.y;
    // Use actual text width as labelWidth to prevent wrapping without over-expanding
    const labelWidth = Math.max(this.textWidth + 4, cw);
    const style = CIRCLE_STYLE + `labelWidth=${labelWidth};`;
    return [mxVertex({
      id: this.node.id, value: this.labelHtml, style,
      x: cx, y: cy, width: cw, height: ch,
    })];
  }
}

/** Register circle-node renderer into global registry. */
export function registerCircleNodeRenderer(): void {
  registerRenderer('circle', (desc: RenderDescriptor) => new CircleNodeRenderer(desc as NodeDescriptor));
}

