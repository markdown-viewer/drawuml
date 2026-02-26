/**
 * Frame shape renderer — standalone node and container.
 *
 * Used for PlantUML `frame` keyword — renders with a pentagon tab.
 */

import { Content } from '../../shared/content.ts';
import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE, CLASS_FILL, RECT_ARC_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class FrameShapeRenderer extends RichRenderer {
  private get isMainframe(): boolean { return this.desc.fixedHeight != null; }

  protected buildStyle(): string {
    if (this.isMainframe) {
      const tabW = Math.max(this.label.length * 8 + 16, 50);
      const tabH = this.desc.fixedHeight ?? 20;
      return `shape=umlFrame;whiteSpace=wrap;html=1;align=left;verticalAlign=top;spacingLeft=8;spacingTop=-2;corner=7;width=${tabW};height=${tabH};fillColor=${CLASS_FILL};`;
    }
    const tabWidth = Math.max(this.label.length * 8 + 16, 50);
    return `shape=umlFrame;rounded=1;absoluteArcSize=1;arcSize=${RECT_ARC_SIZE};whiteSpace=wrap;fontStyle=1;width=${tabWidth};height=20;fontSize=${DEFAULT_FONT_SIZE};align=left;verticalAlign=middle;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};collapsible=0;container=1;`;
  }

  // Frame tab height (height=20); content starts below the tab
  protected get topPadY(): number { return 20; }

  protected doMeasure() {
    if (this.isMainframe) return { width: 0, height: 0 };
    return super.doMeasure();
  }

  // Mainframe: label in frame value, no body content
  protected getFrameValue(): string {
    if (this.isMainframe) return Content.inline(this.label).html;
    return super.getFrameValue();
  }

  protected getBodyHtml(): string {
    if (this.isMainframe) return '';
    return super.getBodyHtml();
  }

  // Convert inline fillColor to swimlaneFillColor for umlFrame body area
  protected postProcessStyle(s: string): string {
    if (this.isMainframe) return s;
    return s.replace(
      /fillColor=([^;"]+)/,
      (_: string, c: string) => c === 'none' ? `fillColor=none` : `fillColor=none;swimlaneFillColor=${c}`
    );
  }
}

export function registerFrameShape(): void {
  registerRenderer('frame', (desc: RenderDescriptor) => new FrameShapeRenderer(desc));
}
