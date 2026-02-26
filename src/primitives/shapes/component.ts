/**
 * Component shape renderer — standalone node and container.
 *
 * Used for PlantUML `component` keyword (handles both component1 and component2,
 * which render identically in PlantUML v1.2026+).
 * Delegates to ArchimateRenderer with a plain rect frame + archimate3.component icon.
 */

import { registerRenderer } from '../registry.ts';
import { createArchimateRenderer } from './archimate.ts';
import type { RenderDescriptor } from '../registry.ts';

export function registerComponentShape(): void {
  const nodeFactory = (desc: RenderDescriptor) => createArchimateRenderer(desc, '', 'mxgraph.archimate3.component');
  // Register for both component1 and component2 (same visual in PlantUML v1.2026+)
  registerRenderer('component', nodeFactory);
  registerRenderer('component1', nodeFactory);
  registerRenderer('component2', nodeFactory);
}
