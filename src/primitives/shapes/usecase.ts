/**
 * Usecase shape renderer — standalone ellipse node.
 *
 * Renders as an ellipse with text centered inside. Supports stereotype labels,
 * inline style (dashed/dotted/bold), and color overrides.
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { ShapeRenderer } from './shape-renderer.ts';
import { normalizeColor, parseNodeStyle, darkenColor } from '../../shared/color-utils.ts';
import { CLASS_FILL, COLOR_DARK, DEFAULT_FONT_SIZE, TITLE_MIN_WIDTH } from '../../shared/theme.ts';
import { buildLabelHtml } from '../label.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_HEIGHT = 40;
const PADDING_X = 50;  // horizontal padding inside ellipse
const PADDING_Y = 24;  // vertical padding inside ellipse

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class UsecaseRenderer extends ShapeRenderer {
  protected buildStyle(): string {
    return `ellipse;whiteSpace=wrap;html=1;fillColor=${CLASS_FILL};strokeColor=${COLOR_DARK};strokeWidth=0.5;fontSize=${DEFAULT_FONT_SIZE};fontColor=${COLOR_DARK};align=center;verticalAlign=middle;`;
  }

  protected get extraPadX(): number { return PADDING_X - 20; }
  protected get extraPadY(): number { return PADDING_Y - 12; }

  // Usecase is always a leaf, never a container
  get isCluster(): boolean { return false; }

  protected doMeasure() {
    const size = Content.inline(this.label).measure();
    let width = Math.max(Math.ceil(size.width) + PADDING_X, TITLE_MIN_WIDTH);
    let height = Math.max(Math.ceil(size.height) + PADDING_Y, MIN_HEIGHT);
    // Add stereotype label height if present
    if (this.desc.stereotypeLabel) height += 16;
    return { width, height };
  }

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    const value = buildLabelHtml({
      label: labelHtml,
      stereotypeLabel: this.desc.stereotypeLabel || undefined,
    });

    let s = this.buildStyle();
    if (this.color) s = s.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);

    // Apply inline style overrides (dashed, dotted, bold, colors)
    if (this.desc.style) {
      const parsed = parseNodeStyle(this.desc.style);
      if (parsed.fillColor) s = s.replace(/fillColor=[^;]*/, `fillColor=${parsed.fillColor}`);
      if (parsed.strokeColor) s = s.replace(/strokeColor=[^;]*/, `strokeColor=${parsed.strokeColor}`);
      else if (parsed.fillColor) s = s.replace(/strokeColor=[^;]*/, `strokeColor=${darkenColor(parsed.fillColor)}`);
      if (parsed.textColor) s = s.replace(/fontColor=[^;]*/, `fontColor=${parsed.textColor}`);
      if (parsed.lineStyle === 'dashed') s += 'dashed=1;';
      else if (parsed.lineStyle === 'dotted') s += 'dashed=1;dashPattern=1 2;';
      else if (parsed.lineStyle === 'bold') s = s.replace(/strokeWidth=[^;]*/, 'strokeWidth=2');
    }

    return [mxVertex({
      id: this.id, value, style: s,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: box.height,
    })];
  }
}

export function registerUsecaseShape(): void {
  registerRenderer('usecase', (desc: RenderDescriptor) => new UsecaseRenderer(desc));
}
