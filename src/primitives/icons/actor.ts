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
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';

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
    let fill = this.theme.defaultFill;
    let stroke = this.theme.colorDark;
    let lineStyle = '';
    let textColor = this.theme.colorDark;
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

  protected get baseIconWidth(): number { return 30; }  // stick figure width at base iconSize=16
  protected get baseIconHeight(): number { return 40; } // stick figure height at base iconSize=16

  render(box: ContentBox) {
    // Build line style modifiers
    let lineStyleStr = '';
    let strokeWidth = this.theme.strokeWidth;
    if (this.lineStyle === 'dashed') lineStyleStr = 'dashed=1;';
    else if (this.lineStyle === 'dotted') lineStyleStr = 'dashed=1;dashPattern=1 2;';
    else if (this.lineStyle === 'bold') strokeWidth = this.theme.boldStrokeWidth;

    const isBusiness = this.desc.stereotype === 'actor/';
    const actorStyleAttr = this.desc.actorStyle ? `actorStyle=${this.desc.actorStyle};` : '';
    const style = `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;`
      + `fillColor=${this.fillColor};strokeColor=${this.strokeColor};strokeWidth=${strokeWidth};`
      + `${lineStyleStr}`
      + (isBusiness ? 'business=1;' : '')
      + actorStyleAttr
      + `fontSize=${this.theme.fontSize};fontColor=${this.textColor};align=center;`;

    // Center the stick figure within the box
    const cx = box.x + (box.width - this.iconWidth) / 2;
    const cy = box.y;

    return [mxVertex({
      id: this.desc.id,
      value: buildLabelHtml({
        label: this.labelHtml,
        stereotypeLabel: this.desc.stereotypeLabel || undefined,
        fontSize: this.theme.fontSize,
      }),
      style,
      parent: this.parentId || '1',
      x: cx,
      y: cy,
      width: this.iconWidth,
      height: this.iconHeight,
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
