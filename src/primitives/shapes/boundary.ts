/**
 * Boundary shape renderer — standalone deployment node.
 *
 * Renders using DrawIO `umlBoundary` shape with label below the icon,
 * same pattern as actor.
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { Renderer } from '../renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { DotContext } from '../renderer.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Circle diameter; total width = diameter * 6/5 so the ellipse portion is a perfect circle
const ICON_DIAMETER = 30;
const ICON_WIDTH = ICON_DIAMETER * 6 / 5;  // = 36
const ICON_HEIGHT = ICON_DIAMETER;
const PADDING_X = 20;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class BoundaryRenderer extends Renderer {
  private desc: RenderDescriptor;

  constructor(desc: RenderDescriptor) {
    super(desc.id);
    this.desc = desc;
  }

  private get label(): string { return this.desc.label ?? ''; }
  private get color(): string | undefined { return this.desc.color; }

  get isCluster(): boolean { return false; }

  protected doMeasure() {
    const size = Content.inline(this.label).measure();
    const labelWidth = size.width + PADDING_X;
    return { width: Math.max(ICON_WIDTH, labelWidth), height: ICON_HEIGHT + 4 + 18 };
  }

  graphicCenterOffset() {
    const h = this.measure().height;
    return { dx: 0, dy: ICON_HEIGHT / 2 - h / 2 };
  }

  buildDotBlock(ctx: DotContext, indent: string): string[] {
    return [`${indent}"${this.id}" [${this.buildDotAttributes(false)}]`];
  }

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    const cx = box.x + Math.round((box.width - ICON_WIDTH) / 2);
    let s = `shape=umlBoundary;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;`
      + `fillColor=none;strokeColor=${COLOR_DARK};strokeWidth=0.5;`
      + `fontSize=${DEFAULT_FONT_SIZE};fontColor=${COLOR_DARK};align=center;`;
    if (this.color) s = s.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style);
    s = styledS;
    if (fontColorOverride) s = s.replace(/fontColor=[^;]*;/, fontColorOverride);
    return [mxVertex({
      id: this.id, value: labelHtml, style: s,
      parent: this.parentId || '1',
      x: cx, y: box.y, width: ICON_WIDTH, height: ICON_HEIGHT,
    })];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBoundaryShape(): void {
  registerRenderer('boundary', (desc: RenderDescriptor) => new BoundaryRenderer(desc));
}
