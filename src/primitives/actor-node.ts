/**
 * Actor node primitive — sizing and rendering for use-case actor (stick figure) nodes.
 * PlantUML renders actors as stick figures with a text label below.
 */

import { measureText } from '@markdown-viewer/text-measure';
import { mxVertex } from '../shared/xml-utils.ts';
import { Renderer } from './renderer.ts';
import { Content } from '../shared/content.ts';
import { buildLabelHtml } from './label.ts';
import { parseNodeStyle } from '../shared/color-utils.ts';
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../shared/theme.ts';
import { registerRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { ContentBox } from '../shared/content.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTOR_WIDTH = 30;   // stick figure width
const ACTOR_HEIGHT = 40;  // stick figure height (head + body + legs)
const TEXT_GAP = 4;       // gap between figure and text
const TEXT_HEIGHT = 18;   // text area height
const PADDING_X = 20;     // horizontal padding for label

import { DEFAULT_FILL, COLOR_DARK } from '../shared/theme.ts';

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class ActorNodeRenderer extends Renderer {
  private node: RenderDescriptor;
  private labelHtml: string;
  private fillColor: string;
  private strokeColor: string;
  private lineStyle: string;
  private textColor: string;

  constructor(node: RenderDescriptor) {
    super(node.id);
    this.node = node;
    this.labelHtml = Content.inline(node.label ?? '').html;

    // Parse inline style if present
    let fill = DEFAULT_FILL;
    let stroke = COLOR_DARK;
    let lineStyle = '';
    let textColor = COLOR_DARK;
    if (node.style) {
      const parsed = parseNodeStyle(node.style);
      if (parsed.fillColor) fill = parsed.fillColor;
      if (parsed.strokeColor) stroke = parsed.strokeColor;
      if (parsed.lineStyle) lineStyle = parsed.lineStyle;
      if (parsed.textColor) textColor = parsed.textColor;
    }
    this.fillColor = fill;
    this.strokeColor = stroke;
    this.lineStyle = lineStyle;
    this.textColor = textColor;
  }

  protected doMeasure() {
    const meas = measureText(this.labelHtml, DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
    const labelWidth = Math.ceil(meas.width) + PADDING_X;
    const width = Math.max(ACTOR_WIDTH, labelWidth);
    const height = ACTOR_HEIGHT + TEXT_GAP + TEXT_HEIGHT;
    return { width, height };
  }

  graphicCenterOffset() {
    // Graphic center is at ACTOR_HEIGHT/2 from top; geometric center is at height/2
    const h = this.measure().height;
    return { dx: 0, dy: ACTOR_HEIGHT / 2 - h / 2 };
  }

  render(box: ContentBox) {
    // Build line style modifiers
    let lineStyleStr = '';
    let strokeWidth = '0.5';
    if (this.lineStyle === 'dashed') lineStyleStr = 'dashed=1;';
    else if (this.lineStyle === 'dotted') lineStyleStr = 'dashed=1;dashPattern=1 2;';
    else if (this.lineStyle === 'bold') strokeWidth = '2';

    const style = `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;`
      + `fillColor=${this.fillColor};strokeColor=${this.strokeColor};strokeWidth=${strokeWidth};`
      + `${lineStyleStr}`
      + `fontSize=${DEFAULT_FONT_SIZE};fontColor=${this.textColor};align=center;`;

    // Center the stick figure within the box
    const cx = box.x + Math.round((box.width - ACTOR_WIDTH) / 2);
    const cy = box.y;

    return [mxVertex({
      id: this.node.id,
      value: buildLabelHtml({
        label: this.labelHtml,
        stereotypeLabel: this.node.stereotypeLabel || undefined,
      }),
      style,
      parent: this.parentId || '1',
      x: cx,
      y: cy,
      width: ACTOR_WIDTH,
      height: ACTOR_HEIGHT,
    })];
  }
}

/** Register actor-node renderer into global registry. */
export function registerActorNodeRenderer(): void {
  registerRenderer('usecase_actor', (desc: RenderDescriptor) => new ActorNodeRenderer(desc));
}
