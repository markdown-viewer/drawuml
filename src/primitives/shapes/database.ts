/**
 * Database shape renderer — standalone node and container.
 *
 * Used for PlantUML `database` keyword — renders as a cylinder.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class DatabaseRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cylinder3;whiteSpace=wrap;size=10;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${this.theme.colorDark};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
  // Top cap height (size=10); reserves top area for ellipse, pushes label down
  protected get topPadY(): number { return 20; }
}

export function registerDatabaseShape(): void {
  registerRenderer('database', (desc: RenderDescriptor) => new DatabaseRenderer(desc));
}
