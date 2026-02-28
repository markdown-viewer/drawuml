/**
 * IconRenderer — abstract base class for icon-with-label-below renderers.
 *
 * Unifies the common "icon on top, text label below" layout pattern used by
 * actor, boundary, control, entity, circle, and mxgraph-icon nodes.
 *
 * Subclasses provide icon dimensions and implement render(). The base class
 * handles doMeasure(), graphicCenterOffset(), and nodeLabel.
 */

import { Renderer } from '../renderer.ts';
import { Content } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

export abstract class IconRenderer extends Renderer {
  protected desc: RenderDescriptor;

  constructor(desc: RenderDescriptor) {
    super(desc.id, desc.theme);
    this.desc = desc;
  }

  // ── Subclass-provided icon geometry ────────────────────────────────────────

  /** Icon graphic width (px). */
  protected abstract get iconWidth(): number;
  /** Icon graphic height (px). */
  protected abstract get iconHeight(): number;

  // ── Configurable layout constants (override to customize) ──────────────────

  /** Gap between icon bottom and label top (px). */
  protected get iconGap(): number { return 4; }
  /** Horizontal padding added to label width (px). */
  protected get paddingX(): number { return 20; }
  /** Minimum label height — single-line floor (px). */
  protected get minLabelHeight(): number { return 18; }

  // ── Label ──────────────────────────────────────────────────────────────────

  protected get label(): string { return this.desc.label ?? ''; }

  /**
   * Measure label dimensions. Override for custom font/size.
   * Default uses Content.inline() with DEFAULT_FONT_SIZE.
   */
  protected measureLabel(): { width: number; height: number } {
    return Content.inline(this.label).measure();
  }

  // ── Layout interface ───────────────────────────────────────────────────────

  get isCluster(): boolean { return false; }

  get nodeLabel(): string { return this.label; }

  protected doMeasure() {
    const size = this.measureLabel();
    const labelH = Math.max(Math.ceil(size.height), this.minLabelHeight);
    const labelW = Math.ceil(size.width) + this.paddingX;
    return {
      width: Math.max(this.iconWidth, labelW),
      height: this.iconHeight + this.iconGap + labelH,
    };
  }

  graphicCenterOffset() {
    const h = this.measure().height;
    return { dx: 0, dy: this.iconHeight / 2 - h / 2 };
  }
}
