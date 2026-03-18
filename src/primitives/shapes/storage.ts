/**
 * Storage shape renderer — standalone node and container.
 *
 * Used for PlantUML `storage` keyword — renders as a rounded rectangle.
 */

import { RichRenderer } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class StorageRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `rounded=1;arcSize=20;whiteSpace=wrap;fontStyle=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=top;spacingTop=${Math.round(this.theme.spacingTop)};fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};collapsible=0;container=1;`;
  }
}

export function registerStorageShape(): void {
  registerRenderer('storage', (desc: RenderDescriptor) => new StorageRenderer(desc));
}
