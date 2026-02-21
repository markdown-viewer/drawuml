/**
 * Database shape renderer — standalone node and container.
 *
 * Used for PlantUML `database` keyword — renders as a cylinder.
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class DatabaseRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=cylinder3;whiteSpace=wrap;size=10;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
  // Extra height for top and bottom ellipse caps (size=10 each)
  protected get extraPadY(): number { return 20; }
  protected get contentYOffset(): number { return 20; }
}

export function registerDatabaseShape(): void {
  registerRenderer('database', (desc: RenderDescriptor) => new DatabaseRenderer(desc));
}
