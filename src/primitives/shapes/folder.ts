/**
 * Folder shape renderer — standalone node and container.
 *
 * Used for PlantUML `folder` and `package` keywords.
 * Package keeps the label in the folder tab; stereotype shown as body content.
 */

import { Content } from '../../shared/content.ts';
import { escapeXml } from '../../shared/xml-utils.ts';
import { RichRenderer } from './rich-renderer.ts';
import { Renderer } from '../renderer.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';

class FolderRenderer extends RichRenderer {
  private isPackage: boolean;

  constructor(desc: RenderDescriptor, isPackage: boolean) {
    super(desc);
    this.isPackage = isPackage;
  }

  protected buildStyle(): string {
    const tabWidth = Math.max(this.label.length * 8 + 16, 50);
    return `shape=folder;fontStyle=1;tabWidth=${tabWidth};tabHeight=20;tabPosition=left;tabFill=1;fontSize=${this.theme.fontSize};align=left;spacingLeft=6;verticalAlign=top;spacingTop=-4;swimlaneHead=0;fillColor=none;strokeColor=${this.theme.colorDark};fontColor=${this.theme.colorDark};swimlaneBody=1;collapsible=0;container=1;`;
  }

  // Folder tab height (tabHeight=20); content starts below the tab
  protected get topPadY(): number { return 20; }

  // Fixed title area: always add tab height (label sits inside the tab)
  // +2 compensates for visual gap difference vs non-fixed shapes (text ~18px < GROUP_TITLE_HEIGHT 20px)
  override get groupTopPadding(): number { return Renderer.GROUP_BASE_PAD + this.topPadY + 2; }

  // Package: label always in folder tab (frame value)
  protected getFrameValue(): string {
    if (this.isPackage) return Content.inline(this.label).html;
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
