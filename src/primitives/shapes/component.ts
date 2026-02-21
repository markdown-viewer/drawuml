/**
 * Component shape renderer — standalone node and container.
 *
 * Used for PlantUML `component` keyword (handles both component1 and component2,
 * which render identically in PlantUML v1.2026+).
 * Uses archimate application shape with appType=comp icon.
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class ComponentRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.archimate.application;appType=comp;whiteSpace=wrap;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
  // Extra width reserves space for the component icon on the right
  protected get extraPadX(): number { return 20; }
  protected get contentWidthReduction(): number { return 20; }
}

export function registerComponentShape(): void {
  const nodeFactory = (desc: RenderDescriptor) => new ComponentRenderer(desc);
  // Register for both component1 and component2 (same visual in PlantUML v1.2026+)
  registerRenderer('component', nodeFactory);
  registerRenderer('component1', nodeFactory);
  registerRenderer('component2', nodeFactory);
}
