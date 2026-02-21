/**
 * Folder shape renderer — standalone node and container.
 *
 * Used for PlantUML `folder` and `package` keywords.
 * Package keeps the label in the folder tab; stereotype shown as body content.
 */

import { Content } from '../../shared/content.ts';
import { escapeXml } from '../../shared/xml-utils.ts';
import { RichRenderer } from './rich-renderer.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
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
    return `shape=folder;fontStyle=1;tabWidth=${tabWidth};tabHeight=20;tabPosition=left;tabFill=1;fontSize=${DEFAULT_FONT_SIZE};align=left;spacingLeft=6;verticalAlign=top;spacingTop=-4;swimlaneHead=0;fillColor=none;strokeColor=${COLOR_DARK};fontColor=${COLOR_DARK};swimlaneBody=1;collapsible=0;container=1;`;
  }

  // Extra height for the folder tab (tabHeight=20)
  protected get extraPadY(): number { return 20; }
  protected get contentYOffset(): number { return 20; }

  // Package: label always in folder tab (frame value)
  protected getFrameValue(): string {
    if (this.isPackage) return Content.inline(this.label).html;
    return super.getFrameValue();
  }

  // Package: show only stereotype in body, not the label
  protected getBodyHtml(): string {
    if (this.isPackage) {
      if (!this.desc.stereotypeLabel) return '';
      return `<div style="font-size:12px;font-style:italic;line-height:1.3;">${escapeXml(this.desc.stereotypeLabel)}</div>`;
    }
    return super.getBodyHtml();
  }
}

export function registerFolderShape(): void {
  registerRenderer('folder', (desc: RenderDescriptor) => new FolderRenderer(desc, false));
  registerRenderer('package', (desc: RenderDescriptor) => new FolderRenderer(desc, true));
}
