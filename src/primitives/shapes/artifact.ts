/**
 * Artifact shape renderer — standalone node and container.
 *
 * Used for PlantUML `artifact` keyword — uses archimate application
 * shape with appType=artifact icon.
 */

import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class ArtifactRenderer extends RichRenderer {
  protected buildStyle(): string {
    return `shape=mxgraph.archimate.application;appType=artifact;whiteSpace=wrap;fontStyle=1;fontSize=${DEFAULT_FONT_SIZE};align=center;verticalAlign=top;spacingTop=2;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
  // Extra width reserves space for the artifact icon on the right
  protected get extraPadX(): number { return 20; }
  protected get contentWidthReduction(): number { return 20; }
}

export function registerArtifactShape(): void {
  registerRenderer('artifact', (desc: RenderDescriptor) => new ArtifactRenderer(desc));
}
