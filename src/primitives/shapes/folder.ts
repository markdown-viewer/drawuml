/**
 * Folder shape renderer — standalone node and container.
 *
 * Used for PlantUML `folder` and `package` keywords.
 * Package keeps the label in the folder tab; stereotype shown as body content.
 */

import { measureText } from '@markdown-viewer/text-measure';
import { Content } from '../../shared/content.ts';
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

  protected buildStyle(): string {
    const tabWidth = Math.max(Math.ceil(measureText(this.label, this.theme.fontSize, this.theme.fontFamily, 'bold', 'normal', false).width) + this.theme.fontSize, this.theme.tabMinWidth);
    return `shape=folder;html=1;whiteSpace=wrap;fontStyle=1;tabWidth=${tabWidth};tabHeight=${this.theme.titleBarHeight};tabPosition=left;tabFill=1;labelInHeader=1;boundedLbl=1;fontSize=${this.theme.fontSize};align=left;spacingLeft=${Math.round(this.theme.fontSize / 2)};verticalAlign=middle;swimlaneHead=0;fillColor=none;strokeColor=${this.theme.colorDark};strokeWidth=${this.theme.strokeWidth};fontColor=${this.theme.colorDark};swimlaneBody=1;collapsible=0;container=1;`;
  }

  // Folder has a fixed titlebar (tab area)
  protected shapePadding(): ShapePadding { return {}; }
  protected override get hasTitlebar(): boolean { return true; }

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
