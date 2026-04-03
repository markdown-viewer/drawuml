/**
 * Database shape renderer — standalone node and container.
 *
 * Used for PlantUML `database` keyword — renders as a cylinder.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import { n4 } from '../../shared/xml-utils.ts';

class DatabaseRenderer extends RichRenderer {
  private get capHeight(): number {
    const baseCap = this.isCluster ? this.theme.portSize * 4 / 3 :
      this.theme.portSize * 2 / 3;
    if (!this.isCluster) return baseCap;
    // Expand cap for multi-line group titles so text stays inside the ellipse area
    const extraLines = Math.max(0, this.label.split('\n').length - 1);
    return baseCap + extraLines * this.theme.fontSize * 0.6;
  }
  protected buildStyle(): string {
    return `shape=cylinder3;whiteSpace=wrap;size=${n4(this.capHeight)};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.spacingTop)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // Top cap ellipse — add cap height as top padding
  protected shapePadding(): ShapePadding {
    return {
      top: this.capHeight
    };
  }
  // capHeight already includes multi-line expansion; skip the generic titleH addition.
  override get groupTopPadding(): number {
    return this.theme.groupPad + this.theme.portSize + this.capHeight;
  }
}

export function registerDatabaseShape(): void {
  registerRenderer('database', (desc: RenderDescriptor) => new DatabaseRenderer(desc));
}
