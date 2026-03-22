/**
 * IconRenderer — abstract base class for icon-with-label-below renderers.
 *
 * Unifies the common "icon on top, text label below" layout pattern used by
 * actor, boundary, control, entity, circle, and mxgraph-icon nodes.
 *
 * Subclasses provide icon dimensions and implement render(). The base class
 * handles doMeasure(), graphicSize(), and nodeLabel.
 */

import { Renderer } from '../renderer.ts';
import { TextBlock } from '../../shared/text-block.ts';
import type { RenderDescriptor } from '../registry.ts';

export abstract class IconRenderer extends Renderer {
  protected desc: RenderDescriptor;

  constructor(desc: RenderDescriptor) {
    super(desc.id, desc.theme);
    this.desc = desc;
  }

  // ── Icon geometry (base aspect ratio + auto-scaled to iconSize) ────────────

  /** Base icon width ratio. Override for non-square icons (e.g. actor 3:4). */
  protected get baseIconWidth(): number { return 16; }
  /** Base icon height ratio. Override for non-square icons (e.g. actor 3:4). */
  protected get baseIconHeight(): number { return 16; }

  /**
   * Scale factor: ensures the narrow side equals theme.sizeM.
   * Subclasses only define aspect ratio via baseIconWidth/baseIconHeight;
   * the base class normalises so min(iconWidth, iconHeight) === sizeM.
   */
  protected get iconScale(): number {
    return this.theme.iconSize / Math.min(this.baseIconWidth, this.baseIconHeight);
  }

  /** Computed icon width (baseIconWidth × iconScale). Override for non-scaled icons. */
  protected get iconWidth(): number { return this.baseIconWidth * this.iconScale; }
  /** Computed icon height (baseIconHeight × iconScale). Override for non-scaled icons. */
  protected get iconHeight(): number { return this.baseIconHeight * this.iconScale; }

  // ── Configurable layout constants (override to customize) ──────────────────

  /** Gap between icon bottom and label top (px). */
  protected get iconGap(): number { return this.theme.edgeGap; }
  /** Horizontal padding added to label width (px). nodeGap provides a visually comfortable icon margin. */
  protected get paddingX(): number { return this.theme.nodeGap; }
  /** Minimum label height — single-line floor (px). */
  protected get minLabelHeight(): number { return this.theme.rowH; }
  /** Whether label is below the icon (default true). */
  protected get labelBelow(): boolean { return (this.desc.labelPosition ?? 'bottom') === 'bottom'; }

  // ── Label ──────────────────────────────────────────────────────────────────

  protected get label(): string { return this.desc.label ?? ''; }

  /**
   * Measure label dimensions. Override for custom font/size.
   * Default uses TextBlock.inline() with theme fontSize.
   */
  protected measureLabel(): { width: number; height: number } {
    return TextBlock.inline(this.label, { size: this.theme.fontSize, family: this.theme.fontFamily }).measure();
  }

  // ── Layout interface ───────────────────────────────────────────────────────

  get isCluster(): boolean { return false; }

  get nodeLabel(): string { return this.label; }

  protected doMeasure() {
    // Icon-only nodes (no label): return icon dimensions without label area
    if (!this.label) {
      return { width: this.iconWidth, height: this.iconHeight };
    }
    const size = this.measureLabel();
    const labelH = Math.max(Math.ceil(size.height), this.minLabelHeight);
    const labelW = Math.ceil(size.width) + this.paddingX;
    return {
      width: Math.max(this.iconWidth, labelW),
      height: this.iconHeight + this.iconGap + labelH,
    };
  }

  graphicSize() {
    // Only report graphic offset when there is a label below the icon
    if (!this.label) return null;
    return { width: this.iconWidth, height: this.iconHeight };
  }
}
