/**
 * Folder shape renderer — standalone node and container.
 *
 * Used for PlantUML `folder` and `package` keywords.
 * Package keeps the label in the folder tab; stereotype shown as body content.
 */

import { TextBlock, DEFAULT_FONT } from '../../shared/text-block.ts';
import { escapeXml } from '../../shared/xml-utils.ts';
import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class FolderRenderer extends RichRenderer {
  private isPackage: boolean;

  constructor(desc: RenderDescriptor, isPackage: boolean) {
    super(desc);
    this.isPackage = isPackage;
  }

  /** Measure tab dimensions accounting for multi-line labels. */
  private computeTabSize(): { width: number; height: number } {
    const font = { size: this.theme.fontSize, family: this.theme.fontFamily, weight: 'bold' as const };
    const lines = this.label.split('\n');
    const maxLineWidth = Math.max(...lines.map(l => Math.ceil(TextBlock.inline(l, font).width)));
    const tabWidth = Math.max(maxLineWidth + 2 * this.theme.cornerClip, this.theme.tabMinW);
    return { width: tabWidth, height: this.computeLabelHeight() };
  }

  protected buildStyle(): string {
    const tab = this.computeTabSize();
    return `shape=folder;html=1;whiteSpace=wrap;fontStyle=1;tabWidth=${tab.width};tabHeight=${tab.height};tabPosition=left;tabFill=1;labelInHeader=1;boundedLbl=1;fontSize=${this.theme.fontSize};align=center;verticalAlign=middle;swimlaneHead=0;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};swimlaneBody=1;collapsible=0;container=1;`;
  }

  protected override doMeasure() {
    const base = super.doMeasure();
    if (this.isCluster) return base;
    // Ensure element width > tabWidth so drawio2svg arc clipping
    // does not eat into the tab's right padding.
    const tab = this.computeTabSize();
    const minWidth = tab.width + this.theme.cornerClip;
    return {
      width: Math.max(base.width, minWidth),
      height: base.height,
    };
  }

  // Folder has a titlebar (tab area) — height adapts for multi-line labels.
  protected shapePadding(): ShapePadding { return {}; }
  protected override get hasTitlebar(): boolean { return true; }
  protected override get titleAreaHeight(): number {
    return this.computeTabSize().height;
  }

  // Package: label always in folder tab (frame value)
  protected getFrameValue(): string {
    if (this.isPackage) return TextBlock.inline(this.label, DEFAULT_FONT).html;
    return super.getFrameValue();
  }

  // Package: show only stereotype in body, not the label
  protected getBodyHtml(): string {
    if (this.isPackage) {
      if (!this.desc.stereotypeLabel) return '';
      // Apply italic only for real stereotype text («...»); display names are plain
      const isStereotype = this.desc.stereotypeLabel.includes('«');
      const fontStyle = isStereotype ? 'font-style:italic;' : '';
      return `<div style="font-size:12px;${fontStyle}line-height:1.3;">${escapeXml(this.desc.stereotypeLabel)}</div>`;
    }
    return super.getBodyHtml();
  }
}

export function registerFolderShape(): void {
  registerRenderer('folder', (desc: RenderDescriptor) => new FolderRenderer(desc, false));
  registerRenderer('package', (desc: RenderDescriptor) => new FolderRenderer(desc, true));
}
