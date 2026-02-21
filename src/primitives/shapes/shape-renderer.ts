/**
 * ShapeRenderer — base class for all shape renderers in `primitives/shapes/`.
 *
 * Extracts common logic: constructor, label/color getters, doMeasure,
 * buildDotBlock, and the standard container/leaf render pattern.
 *
 * Subclasses provide buildStyle() and optional padding/offset overrides.
 */

import { Content } from '../../shared/content.ts';
import { mxVertex, mxContentLabel } from '../../shared/xml-utils.ts';
import { Renderer } from '../renderer.ts';
import { buildClusterDotBlock } from '../group.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE, TITLE_MIN_WIDTH, TITLE_PAD_X, TITLE_PAD_Y } from '../../shared/theme.ts';
import type { DotContext } from '../renderer.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

export abstract class ShapeRenderer extends Renderer {
  protected desc: RenderDescriptor;

  constructor(desc: RenderDescriptor) {
    super(desc.id);
    this.desc = desc;
  }

  protected get label(): string { return this.desc.label ?? ''; }
  protected get color(): string | undefined { return this.desc.color; }

  /** Build the DrawIO style string. Each shape must implement this. */
  protected abstract buildStyle(): string;

  /** Extra horizontal padding beyond TITLE_PAD_X for doMeasure. */
  protected get extraPadX(): number { return 0; }

  /** Extra vertical padding beyond TITLE_PAD_Y for doMeasure. */
  protected get extraPadY(): number { return 0; }

  /** Horizontal offset for the content label in leaf mode. */
  protected get contentXOffset(): number { return 0; }

  /** Vertical offset for the content label in leaf mode. */
  protected get contentYOffset(): number { return 0; }

  /** Width reduction for the content label (e.g., icon on the right). */
  protected get contentWidthReduction(): number { return 0; }

  protected doMeasure() {
    if (this.isCluster) return { width: 0, height: 0 };
    const size = Content.inline(this.label).measure();
    return {
      width: Math.max(TITLE_MIN_WIDTH, size.width + TITLE_PAD_X + this.extraPadX),
      height: size.height + TITLE_PAD_Y + this.extraPadY,
    };
  }

  buildDotBlock(ctx: DotContext, indent: string): string[] {
    if (this.isCluster) return buildClusterDotBlock(this.id, this.label, this.children, ctx, indent);
    return [`${indent}"${this.id}" [${this.buildDotAttributes(false)}]`];
  }

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    let s = this.buildStyle();
    if (this.color) s = s.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    if (!this.isCluster) s = s.replace('container=1;', '');
    // Container labels should appear at the top, not centered
    if (this.isCluster) s = s.replace('verticalAlign=middle', 'verticalAlign=top');

    // Apply parsed inline style via base class utility
    const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style);
    s = styledS;

    const cells = [mxVertex({
      id: this.id,
      value: this.isCluster ? labelHtml : '',
      style: s,
      parent: this.parentId || '1',
      x: box.x, y: box.y, width: box.width, height: box.height,
    })];
    if (this.isCluster) {
      // Render direct children; sub-groups handle their own via polymorphism
      cells.push(...this.renderChildren());
    } else if (labelHtml) {
      const labelStyle = `fontSize=${DEFAULT_FONT_SIZE};${fontColorOverride || `fontColor=${COLOR_DARK};`}`;
      cells.push(mxContentLabel(
        this.id, labelHtml,
        box.width - this.contentWidthReduction, box.height,
        labelStyle,
        this.contentYOffset, this.contentXOffset,
      ));
    }
    return cells;
  }

  /** Expose shape layout info for bracket-body content rendering. */
  getShapeInfo() {
    return {
      style: this.buildStyle(),
      extraPadX: this.extraPadX,
      extraPadY: this.extraPadY,
      contentXOffset: this.contentXOffset,
      contentYOffset: this.contentYOffset,
      contentWidthReduction: this.contentWidthReduction,
    };
  }
}
