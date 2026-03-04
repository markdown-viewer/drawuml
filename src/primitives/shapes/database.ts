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
    return this.isCluster ? this.theme.sizeXS * 4 / 3 :
      this.theme.sizeXS * 2 / 3;
  }
  protected buildStyle(): string {
    return `shape=cylinder3;whiteSpace=wrap;size=${n4(this.capHeight)};fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // Top cap ellipse — add cap height as top padding
  protected shapePadding(): ShapePadding {
    return {
      top: this.capHeight
    };
  }
}

export function registerDatabaseShape(): void {
  registerRenderer('database', (desc: RenderDescriptor) => new DatabaseRenderer(desc));
}
