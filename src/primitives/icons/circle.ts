/**
 * Circle node renderer — small filled circle with text label below.
 *
 * Extends IconRenderer with circle-specific measurement (TITLE_FONT_SIZE)
 * and ellipse-based DrawIO style with labelWidth control.
 */

import { measureText } from '@markdown-viewer/text-measure';
import { IconRenderer } from './icon-renderer.ts';
import { Renderer } from '../renderer.ts';
import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { buildLabelHtml } from '../label.ts';
import { DEFAULT_FONT_FAMILY, TITLE_FONT_SIZE, DEFAULT_FILL, COLOR_DARK } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor, NodeDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CIRCLE_DIAMETER = 16;    // PlantUML: rx=8, ry=8
const CIRCLE_TEXT_GAP = 16;    // gap between circle and text below

const CIRCLE_STYLE = 'ellipse;whiteSpace=wrap;html=1;aspect=fixed;'
  + `fillColor=${DEFAULT_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;`
  + `fontSize=${TITLE_FONT_SIZE};fontColor=${COLOR_DARK};`
  + 'verticalLabelPosition=bottom;labelPosition=center;verticalAlign=top;align=center;';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class CircleRenderer extends IconRenderer {
  private labelHtml: string;
  private textWidth: number;

  constructor(desc: RenderDescriptor) {
    super(desc);
    this.labelHtml = Content.inline(this.label).html;
    // Pre-measure with TITLE_FONT_SIZE to cache textWidth for render()
    const meas = measureText(this.labelHtml, TITLE_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
    this.textWidth = Math.ceil(meas.width);
  }

  protected get iconWidth(): number { return CIRCLE_DIAMETER; }
  protected get iconHeight(): number { return CIRCLE_DIAMETER; }
  protected override get iconGap(): number { return CIRCLE_TEXT_GAP; }
  protected override get paddingX(): number { return 40; }

  // Override: circle uses TITLE_FONT_SIZE for measurement
  protected override measureLabel() {
    return measureText(this.labelHtml, TITLE_FONT_SIZE, DEFAULT_FONT_FAMILY, 'normal', 'normal', true);
  }

  // Override: padding applies to icon width too
  protected override doMeasure() {
    const size = this.measureLabel();
    const labelH = Math.max(Math.ceil(size.height), this.minLabelHeight);
    return {
      width: Math.max(this.textWidth + this.paddingX, this.iconWidth + this.paddingX),
      height: this.iconHeight + this.iconGap + labelH,
    };
  }

  render(box: ContentBox) {
    const cx = box.x + Math.round((box.width - CIRCLE_DIAMETER) / 2);
    const cy = box.y;
    // Use actual text width as labelWidth to prevent wrapping without over-expanding
    const labelWidth = Math.max(this.textWidth + 4, CIRCLE_DIAMETER);
    let s = CIRCLE_STYLE + `labelWidth=${labelWidth};`;
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style);
    s = styledS;
    if (fontColorOverride) s = s.replace(/fontColor=[^;]*;/, fontColorOverride);
    return [mxVertex({
      id: this.desc.id, value: buildLabelHtml({
        label: this.labelHtml,
        stereotypeLabel: this.desc.stereotypeLabel || undefined,
      }), style: s,
      parent: this.parentId || '1',
      x: cx, y: cy, width: CIRCLE_DIAMETER, height: CIRCLE_DIAMETER,
    })];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCircleRenderer(): void {
  const factory = (desc: RenderDescriptor) => new CircleRenderer(desc);
  registerRenderer('circle', factory);
}
