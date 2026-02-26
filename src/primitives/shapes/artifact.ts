/**
 * Artifact shape renderer — standalone node and container.
 *
 * Used for PlantUML `artifact` keyword — delegates to ArchimateRenderer
 * with a plain rect frame + archimate3.artifact icon.
 */

import { registerRenderer } from '../registry.ts';
import { createArchimateRenderer } from './archimate.ts';
import type { RenderDescriptor } from '../registry.ts';

export function registerArtifactShape(): void {
  registerRenderer('artifact', (desc: RenderDescriptor) => createArchimateRenderer(desc, '', 'mxgraph.archimate3.artifact'));
}
