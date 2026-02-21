/**
 * Storage shape renderer — standalone node and container.
 *
 * Used for PlantUML `storage` keyword — renders as a rounded rectangle.
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class StorageRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `rounded=1;arcSize=20;whiteSpace=wrap;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
}

export function registerStorageShape(): void {
  registerRenderer('storage', (desc: RenderDescriptor) => new StorageRenderer(desc));
}
