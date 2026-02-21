/**
 * Folder shape renderer — standalone node and container.
 *
 * Used for PlantUML `folder` and `package` keywords.
 * Package keeps the label in the folder tab; folder displays it as a content cell.
 */

import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { ShapeRenderer } from './shape-renderer.ts';
import { Renderer } from '../renderer.ts';
import { normalizeColor } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';
import type { RenderDescriptor } from '../registry.ts';

class FolderRenderer extends ShapeRenderer {
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

  render(box: ContentBox): string[] {
    const labelHtml = Content.inline(this.label).html;
    let s = this.buildStyle();
    if (this.color) s = s.replace(/fillColor=[^;]*/, `fillColor=${normalizeColor(this.color)}`);
    // Package: label always in folder tab (value), no content label
    if (this.isPackage) {
      const { style: styledS, fontColorOverride } = Renderer.applyInlineStyle(s, this.desc.style);
      s = styledS;
      if (fontColorOverride) s = s.replace(/fontColor=[^;]*;/, fontColorOverride);
      if (!this.isCluster) s = s.replace('container=1;', '');
      const cells = [mxVertex({
        id: this.id, value: labelHtml, style: s,
        parent: this.parentId || '1',
        x: box.x, y: box.y, width: box.width, height: box.height,
      })];
      if (this.isCluster) cells.push(...this.renderChildren());
      return cells;
    }
    // Folder: delegate to base class container/leaf render pattern
    return super.render(box);
  }
}

export function registerFolderShape(): void {
  registerRenderer('folder', (desc: RenderDescriptor) => new FolderRenderer(desc, false));
  registerRenderer('package', (desc: RenderDescriptor) => new FolderRenderer(desc, true));
}
