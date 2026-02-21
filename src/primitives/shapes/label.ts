/**
 * Label shape renderer — standalone deployment node.
 *
 * Renders as plain text with no border or background (just the label).
 */

import { RichRenderer } from './rich-renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class LabelRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `text;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=middle;fillColor=none;strokeColor=none;fontColor=${COLOR_DARK};whiteSpace=wrap;`;
  }
  get isCluster(): boolean { return false; }

  // Label uses fontColor for color override (no fill/stroke)
  protected applyColorOverride(style: string): string {
    if (this.color) return style.replace(/fontColor=[^;]*/, `fontColor=${normalizeColor(this.color)}`);
    return style;
  }
}

export function registerLabelShape(): void {
  registerRenderer('label', (desc: RenderDescriptor) => new LabelRenderer(desc));
}
