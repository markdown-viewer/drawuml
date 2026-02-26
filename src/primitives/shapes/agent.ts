/**
 * Agent shape renderer — standalone node and container.
 *
 * Used for PlantUML `agent` keyword — renders as a plain rectangle.
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE, RECT_ARC_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class AgentRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.basic.rect;rounded=1;absoluteArcSize=1;arcSize=${RECT_ARC_SIZE};fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
}

export function registerAgentShape(): void {
  registerRenderer('agent', (desc: RenderDescriptor) => new AgentRenderer(desc));
}
