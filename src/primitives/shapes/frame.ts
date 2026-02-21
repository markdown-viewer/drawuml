/**
 * Frame shape renderer — standalone node and container.
 *
 * Used for PlantUML `frame` keyword — renders with a pentagon tab.
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { ShapeRenderer } from './shape-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE, CLASS_FILL } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

class FrameShapeRenderer extends ShapeRenderer {
  private get isMainframe(): boolean { return this.desc.fixedHeight != null; }

  protected buildStyle(): string {
    const tabWidth = Math.max(this.label.length * 8 + 16, 50);
    return `shape=umlFrame;whiteSpace=wrap;fontStyle=1;width=${tabWidth};height=20;fontSize=${DEFAULT_FONT_SIZE};align=left;verticalAlign=middle;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }
  // Extra height for the frame tab (height=20)
  protected get extraPadY(): number { return 20; }
  protected get contentYOffset(): number { return 20; }

  protected doMeasure() {
    if (this.isMainframe) return { width: 0, height: 0 };
    return super.doMeasure();
  }

  render(box: ContentBox): string[] {
    // Mainframe mode: label in tab, CLASS_FILL background
    if (this.isMainframe) {
      const labelHtml = Content.inline(this.label).html;
      const tabH = this.desc.fixedHeight ?? 20;
      const tabW = Math.max(this.label.length * 8 + 16, 50);
      const style = `shape=umlFrame;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=-2;corner=7;width=${tabW};height=${tabH};fillColor=${CLASS_FILL};`;
      return [mxVertex({
        id: this.id, value: labelHtml, style,
        parent: this.parentId || '1',
        x: box.x, y: box.y, width: box.width, height: box.height,
      })];
    }
    // Normal frame: delegate to base class container/leaf render pattern
    const cells = super.render(box);
    // If inline style set a fillColor, move it to swimlaneFillColor
    // so uml-frame renders it as the content area background.
    if (cells.length > 0) {
      cells[0] = cells[0].replace(
        /fillColor=([^;"]+)/,
        (_, c) => c === 'none' ? `fillColor=none` : `fillColor=none;swimlaneFillColor=${c}`
      );
    }
    return cells;
  }
}

export function registerFrameShape(): void {
  registerRenderer('frame', (desc: RenderDescriptor) => new FrameShapeRenderer(desc));
}
