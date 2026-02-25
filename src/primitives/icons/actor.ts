/**
 * Actor node renderer — stick figure with text label below.
 *
 * Extends IconRenderer with actor-specific style handling (parseNodeStyle for
 * fill/stroke/line styling, business actor variant, actorStyle attribute).
 */

import { IconRenderer } from './icon-renderer.ts';
import { Renderer } from '../renderer.ts';
import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { buildLabelHtml } from '../label.ts';
import { parseNodeStyle } from '../../shared/color-utils.ts';
import { DEFAULT_FONT_SIZE, DEFAULT_FILL, COLOR_DARK } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTOR_WIDTH = 30;   // stick figure width
const ACTOR_HEIGHT = 40;  // stick figure height (head + body + legs)

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class ActorRenderer extends IconRenderer {
  private labelHtml: string;
  private fillColor: string;
  private strokeColor: string;
  private lineStyle: string;
  private textColor: string;

  constructor(desc: RenderDescriptor) {
    super(desc);
    this.labelHtml = Content.inline(this.label).html;

    // Parse inline style if present
    let fill = DEFAULT_FILL;
    let stroke = COLOR_DARK;
    let lineStyle = '';
    let textColor = COLOR_DARK;
    if (desc.style) {
      const parsed = parseNodeStyle(desc.style);
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

  protected get iconWidth(): number { return ACTOR_WIDTH; }
  protected get iconHeight(): number { return ACTOR_HEIGHT; }

  render(box: ContentBox) {
    // Build line style modifiers
    let lineStyleStr = '';
    let strokeWidth = '0.5';
    if (this.lineStyle === 'dashed') lineStyleStr = 'dashed=1;';
    else if (this.lineStyle === 'dotted') lineStyleStr = 'dashed=1;dashPattern=1 2;';
    else if (this.lineStyle === 'bold') strokeWidth = '2';

    const isBusiness = this.desc.stereotype === 'actor/';
    const actorStyleAttr = this.desc.actorStyle ? `actorStyle=${this.desc.actorStyle};` : '';
    const style = `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;`
      + `fillColor=${this.fillColor};strokeColor=${this.strokeColor};strokeWidth=${strokeWidth};`
      + `${lineStyleStr}`
      + (isBusiness ? 'business=1;' : '')
      + actorStyleAttr
      + `fontSize=${DEFAULT_FONT_SIZE};fontColor=${this.textColor};align=center;`;

    // Center the stick figure within the box
    const cx = box.x + Math.round((box.width - ACTOR_WIDTH) / 2);
    const cy = box.y;

    return [mxVertex({
      id: this.desc.id,
      value: buildLabelHtml({
        label: this.labelHtml,
        stereotypeLabel: this.desc.stereotypeLabel || undefined,
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

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerActorRenderer(): void {
  const factory = (desc: RenderDescriptor) => new ActorRenderer(desc);
  registerRenderer('usecase_actor', factory);
  registerRenderer('actor', factory);
  registerRenderer('actor/', factory);
}
