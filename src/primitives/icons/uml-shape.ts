/**
 * UML shape icon renderer — handles boundary, control, and entity shapes.
 *
 * These three UML shapes share an identical layout: a shape icon on top with
 * a text label below. Only the DrawIO shape name and icon dimensions differ,
 * so they are unified into one data-driven renderer class.
 */

import { IconRenderer } from './icon-renderer.ts';
import { Renderer } from '../renderer.ts';
import { TextBlock, DEFAULT_FONT } from '../../shared/text-block.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { buildLabelHtml } from '../label.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content-types.ts';
import type { RenderDescriptor } from '../registry.ts';
import { fontFamilyStyle } from '../../shared/theme.ts';

// ---------------------------------------------------------------------------
// Shape configuration
// ---------------------------------------------------------------------------

interface UmlShapeConfig {
  shape: string;
  iconWidth: number;
  iconHeight: number;
}

const UML_SHAPES: Record<string, UmlShapeConfig> = {
  boundary: { shape: 'umlBoundary', iconWidth: 36, iconHeight: 30 },
  control:  { shape: 'umlControl',  iconWidth: 30, iconHeight: 35 },
  entity:   { shape: 'umlEntity',   iconWidth: 30, iconHeight: 30 },
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

class UmlShapeRenderer extends IconRenderer {
  private config: UmlShapeConfig;

  constructor(desc: RenderDescriptor, config: UmlShapeConfig) {
    super(desc);
    this.config = config;
  }

  protected get baseIconWidth(): number { return this.config.iconWidth; }
  protected get baseIconHeight(): number { return this.config.iconHeight; }

  private get color(): string | undefined { return this.desc.color; }

  render(box: ContentBox): string[] {
    const labelHtml = TextBlock.inline(this.label, DEFAULT_FONT).html;
    const value = buildLabelHtml({
      label: labelHtml,
      stereotypeLabel: this.desc.stereotypeLabel || undefined,
      fontSize: this.theme.fontSize,
    });
    const cx = box.x + (box.width - this.iconWidth) / 2;
    let s = `shape=${this.config.shape};verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;`
      + `fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};`
      + `fontSize=${this.theme.fontSize};fontColor=${this.theme.colorDark};align=center;`
      + fontFamilyStyle(this.theme);
    if (this.color) s = s.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style, this.theme.boldStrokeWidth);
    s = styledS;
    if (fontColorOverride) s = s.replace(/fontColor=[^;]*;/, fontColorOverride);
    return [mxVertex({
      id: this.id, value, style: s,
      parent: this.parentId || '1',
      x: cx, y: box.y, width: this.iconWidth, height: this.iconHeight,
    })];
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerUmlShapes(): void {
  for (const [type, config] of Object.entries(UML_SHAPES)) {
    registerRenderer(type, (desc: RenderDescriptor) => new UmlShapeRenderer(desc, config));
  }
}
