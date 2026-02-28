/**
 * Label shape renderer — standalone text label.
 *
 * Renders as plain text with no border or background.
 * Used both as a deployment node shape and for edge label rendering.
 *
 * Uses Content.block() for proper multi-line / block-level Creole handling.
 */

import { RichRenderer } from './rich-renderer.ts';
import { Content } from '../../shared/content.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

export class LabelRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `text;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;fillColor=none;strokeColor=none;fontColor=${this.theme.colorDark};whiteSpace=wrap;`;
  }
  get isCluster(): boolean { return false; }

  // Use block-level Creole for multi-line label support
  protected buildContent(): Content {
    if (this.hasRichBody) return super.buildContent();
    return Content.block(this.label);
  }

  // No min-width or padding for borderless text labels
  protected doMeasure() {
    const size = this.content.measure();
    return { width: size.width, height: size.height };
  }

  // Label uses fontColor for color override (no fill/stroke)
  protected applyColorOverride(style: string): string {
    if (this.color) return style.replace(/fontColor=[^;]*/, `fontColor=${normalizeColor(this.color)}`);
    return style;
  }
}

export function registerLabelShape(): void {
  registerRenderer('label', (desc: RenderDescriptor) => new LabelRenderer(desc));
}
