/**
 * Usecase shape renderer — standalone ellipse node.
 *
 * Renders as an ellipse with text centered inside. Supports stereotype labels,
 * inline style (dashed/dotted/bold), and color overrides.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import type { SeparatorBoundsFn } from '../../shared/content-types.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class UsecaseRenderer extends RichRenderer {
  private readonly isBusiness: boolean;

  constructor(desc: RenderDescriptor, isBusiness = false) {
    super(desc);
    this.isBusiness = isBusiness;
  }

  protected buildStyle(): string {
    const base = `whiteSpace=wrap;html=1;fillColor=${this.theme.defaultFill};strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontSize=${this.theme.fontSize};fontColor=${this.theme.fontColor};align=center;verticalAlign=middle;`;
    if (this.isBusiness) {
      // Business usecase: ellipse with a diagonal slash (lineEllipse extension)
      return `shape=lineEllipse;line=diagonal;` + base;
    }
    return `ellipse;` + base;
  }

  // Ellipse padding computed from inscribed rectangle geometry:
  // For text rect inscribed in an ellipse, ellipse size = textRect * √2.
  // The extra space on each side = textRect * (√2 - 1) / 2, minus half fontSize for tighter fit.
  protected shapePadding(contentSize?: { width: number; height: number }): ShapePadding {
    if (!contentSize) return {};
    const factor = (Math.SQRT2 - 1) / 2;
    const halfChar = this.theme.cornerClip;
    return {
      left: Math.ceil(contentSize.width * factor - halfChar),
      right: Math.ceil(contentSize.width * factor - halfChar),
      top: Math.ceil(contentSize.height * factor - halfChar),
      bottom: Math.ceil(contentSize.height * factor - halfChar),
    };
  }

  // Usecase is always a leaf, never a container
  get isCluster(): boolean { return false; }

  // Separator spans the ellipse chord at the given y
  protected separatorBounds(boxW: number, boxH: number): SeparatorBoundsFn | undefined {
    const rx = boxW / 2;
    const ry = boxH / 2;
    return (centerY: number) => {
      const dy = centerY - ry;
      const t = 1 - (dy * dy) / (ry * ry);
      const halfW = t > 0 ? rx * Math.sqrt(t) : 0;
      return { x: rx - halfW, width: halfW * 2 };
    };
  }
}

export function registerUsecaseShape(): void {
  registerRenderer('usecase', (desc: RenderDescriptor) => new UsecaseRenderer(desc, false));
  // Business usecase variant: ellipse with diagonal slash
  registerRenderer('usecase/', (desc: RenderDescriptor) => new UsecaseRenderer(desc, true));
}
