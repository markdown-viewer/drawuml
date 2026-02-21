/**
 * Usecase shape renderer — standalone ellipse node.
 *
 * Renders as an ellipse with text centered inside. Supports stereotype labels,
 * inline style (dashed/dotted/bold), and color overrides.
 */

import { RichRenderer } from './rich-renderer.ts';
import { CLASS_FILL, COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class UsecaseRenderer extends RichRenderer {
  private readonly isBusiness: boolean;

  constructor(desc: RenderDescriptor, isBusiness = false) {
    super(desc);
    this.isBusiness = isBusiness;
  }

  protected buildStyle(): string {
    const base = `whiteSpace=wrap;html=1;fillColor=${CLASS_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;fontSize=${DEFAULT_FONT_SIZE};fontColor=${COLOR_DARK};align=center;verticalAlign=middle;`;
    if (this.isBusiness) {
      // Business usecase: ellipse with a diagonal slash (lineEllipse extension)
      return `shape=lineEllipse;line=diagonal;` + base;
    }
    return `ellipse;` + base;
  }

  // Ellipse needs generous padding for visual balance
  protected get extraPadX(): number { return 30; }
  protected get extraPadY(): number { return 12; }

  // Usecase is always a leaf, never a container
  get isCluster(): boolean { return false; }
}

export function registerUsecaseShape(): void {
  registerRenderer('usecase', (desc: RenderDescriptor) => new UsecaseRenderer(desc, false));
  // Business usecase variant: ellipse with diagonal slash
  registerRenderer('usecase/', (desc: RenderDescriptor) => new UsecaseRenderer(desc, true));
}
