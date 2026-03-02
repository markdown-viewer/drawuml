/**
 * Frame shape renderer — standalone node and container.
 *
 * Used for PlantUML `frame` keyword — renders with a pentagon tab.
 * Also exports buildUmlFrameStyle() for reuse by sequence-diagram fragments.
 */

import { measureText } from '@markdown-viewer/text-measure';
import { Content } from '../../shared/content.ts';
import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

// ---------------------------------------------------------------------------
// Shared umlFrame style builder
// ---------------------------------------------------------------------------

/** Options for building a umlFrame DrawIO style string. */
export interface UmlFrameStyleOpts {
  tabWidth: number;
  tabHeight: number;
  fontSize: number;
  cornerClip: number;
  strokeWidth: number;
  spacingLeft?: number;
  fillColor?: string;
  strokeColor?: string;
  fontColor?: string;
  arcSize?: number;
  container?: boolean;
}

/**
 * Build a `shape=umlFrame` DrawIO style string from the given options.
 * Shared by FrameShapeRenderer (class diagram) and renderFragment (sequence diagram).
 */
export function buildUmlFrameStyle(opts: UmlFrameStyleOpts): string {
  const parts = [
    'shape=umlFrame', 'whiteSpace=wrap', 'html=1', 'fontStyle=1',
    'align=left', 'verticalAlign=middle',
    `spacingLeft=${opts.spacingLeft ?? Math.round(opts.fontSize / 2)}`,
    `corner=${opts.cornerClip}`,
    `width=${opts.tabWidth}`,
    `height=${opts.tabHeight}`,
    `fontSize=${opts.fontSize}`,
    `strokeWidth=${opts.strokeWidth}`,
  ];
  if (opts.arcSize != null) {
    parts.push('rounded=1', 'absoluteArcSize=1', `arcSize=${opts.arcSize}`);
  }
  if (opts.fillColor != null) parts.push(`fillColor=${opts.fillColor}`);
  if (opts.strokeColor != null) parts.push(`strokeColor=${opts.strokeColor}`);
  if (opts.fontColor != null) parts.push(`fontColor=${opts.fontColor}`);
  if (opts.container) parts.push('collapsible=0', 'container=1');
  return parts.join(';') + ';';
}

// ---------------------------------------------------------------------------
// FrameShapeRenderer
// ---------------------------------------------------------------------------

class FrameShapeRenderer extends RichRenderer {
  private get isMainframe(): boolean { return this.desc.fixedHeight != null; }

  protected buildStyle(): string {
    // Measure tab text after Creole processing (strip markup like **bold** etc.)
    const labelHtml = Content.inline(this.label).html;
    const tabW = Math.max(Math.ceil(measureText(labelHtml, this.theme.fontSize, this.theme.fontFamily, 'bold', 'normal', true).width) + this.theme.fontSize, this.theme.tabMinWidth);
    if (this.isMainframe) {
      const tabH = this.desc.fixedHeight ?? this.theme.titleBarHeight;
      return buildUmlFrameStyle({
        tabWidth: tabW, tabHeight: tabH,
        fontSize: this.theme.fontSize, cornerClip: this.theme.cornerClip,
        strokeWidth: this.theme.strokeWidth,
        fillColor: this.theme.classFill,
      });
    }
    return buildUmlFrameStyle({
      tabWidth: tabW, tabHeight: this.theme.titleBarHeight,
      fontSize: this.theme.fontSize, cornerClip: this.theme.cornerClip,
      strokeWidth: this.theme.strokeWidth, arcSize: this.theme.arcSize,
      fillColor: 'none', strokeColor: this.theme.colorDark,
      fontColor: this.theme.colorDark, container: true,
    });
  }

  // Frame has a fixed titlebar (pentagon tab area)
  protected shapePadding(): ShapePadding { return {}; }
  protected override get hasTitlebar(): boolean { return true; }

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
