/**
 * ArchiMate shape renderer.
 *
 * All stereotypes share a unified two-part layout:
 *   1. Outer frame  — plain rect (or rounded / dashed per ArchiMate spec)
 *   2. Icon overlay — a 15×15 mxgraph.archimate3.* child cell at the top-right
 *
 * This replaces the old mxgraph.archimate.* composite handlers that drew both
 * frame and icon in one shape, and keeps the rendering path identical for
 * every stereotype.
 */

import { RichRenderer } from './rich-renderer.ts';
import type { ShapePadding } from './rich-renderer.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { parseNodeStyle } from '../../shared/color-utils.ts';
import { JunctionRenderer } from '../icons/junction.ts';

import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content-types.ts';

// ---------------------------------------------------------------------------
// Stereotype → DrawIO style mapping
// ---------------------------------------------------------------------------

/**
 * Frame style per stereotype (plain rect unless ArchiMate spec calls for a
 * distinctive outline — rounded for strategy/implementation, dashed for grouping).
 * No mxgraph.archimate.* shape references; icons come from ARCHIMATE_ICON_MAP.
 */
const ARCHIMATE_STYLE_MAP: Record<string, string> = {
  // Business layer
  'business-actor':          '',
  'business-role':           '',
  'business-service':        'rounded=1',
  'business-process':        'rounded=1',
  'business-function':       'rounded=1',
  'business-interaction':    'rounded=1',
  'business-event':          'rounded=1',
  'business-interface':      '',
  'business-collaboration':  '',
  'business-object':         '',
  'business-product':        '',
  'business-representation': '',
  'business-contract':       '',
  'business-location':       '',

  // Application layer
  'application-component':     '',
  'application-service':       'rounded=1',
  'application-function':      'rounded=1',
  'application-interaction':   'rounded=1',
  'application-interface':     '',
  'application-collaboration': '',
  'application-event':         'rounded=1',
  'application-process':       'rounded=1',
  'application-dataobject':    '',

  // Technology layer
  'technology-device':                '',
  'technology-node':                  '',
  'technology-artifact':              '',
  'technology-systemsoftware':        '',
  'technology-communicationnetwork':  '',
  'technology-path':                  '',
  'technology-service':               'rounded=1',
  'technology-process':               'rounded=1',
  'technology-function':              'rounded=1',
  'technology-interaction':           'rounded=1',
  'technology-event':                 'rounded=1',
  'technology-interface':             '',
  'technology-collaboration':         '',

  // Motivation layer — octagon frame (dx=5 → 10px corner clips, matching PlantUML reference)
  'motivation-stakeholder':  'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-driver':       'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-assessment':   'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-goal':         'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-outcome':      'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-principle':    'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-requirement':  'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-constraint':   'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-meaning':      'shape=mxgraph.basic.octagon2;dx=5',
  'motivation-value':        'shape=mxgraph.basic.octagon2;dx=5',

  // Strategy layer — rounded per ArchiMate spec
  'strategy-capability':    'rounded=1',
  'strategy-courseofaction': 'rounded=1',
  'strategy-resource':      '',
  'strategy-valuestream':   'rounded=1',

  // Implementation layer
  'implementation-deliverable':  '',
  'implementation-event':        'rounded=1',
  'implementation-gap':          '',
  'implementation-plateau':      '',
  'implementation-workpackage':  'rounded=1',

  // Physical layer (stereotypes use technology- prefix per PlantUML stdlib)
  'technology-distributionnetwork': '',
  'technology-equipment':           '',
  'technology-facility':            '',
  'technology-material':            '',

  // Junctions — filled/empty ellipse (no icon, no topPad)
  'archimate-junction-and': 'ellipse;fillColor=#000000;fontColor=#ffffff;strokeColor=#000000',
  'archimate-junction-or':  'ellipse',

  // Boundary — dashed rect container
  'archimate-boundary': 'dashed=1;dashPattern=8 5',

  // Grouping shapes — folder frame
  'archimate-grouping': '',
  'archimate-group':    '',
  'other-grouping':     '',
  'location':           '',

  // Fallback for bare "archimate" keyword without specific stereotype
  'archimate':      '',
};

/**
 * Maps every stereotype to its mxgraph.archimate3.* icon shape.
 * The icon is rendered as a 15×15 child cell at the top-right of the frame.
 * Stereotypes mapped to null render a plain frame with no icon.
 */
const ARCHIMATE_ICON_MAP: Record<string, string | null> = {
  // Business layer
  'business-actor':          'mxgraph.archimate3.actor',
  'business-role':           'mxgraph.archimate3.role',
  'business-service':        'mxgraph.archimate3.service',
  'business-process':        'mxgraph.archimate3.process',
  'business-function':       'mxgraph.archimate3.function',
  'business-interaction':    'mxgraph.archimate3.interaction',
  'business-event':          'mxgraph.archimate3.event',
  'business-interface':      'mxgraph.archimate3.interface',
  'business-collaboration':  'mxgraph.archimate3.collaboration',
  'business-object':         'mxgraph.archimate3.passive',
  'business-product':        'mxgraph.archimate3.productSmall',
  'business-representation': 'mxgraph.archimate3.representation',
  'business-contract':       'mxgraph.archimate3.contract',
  'business-location':       'mxgraph.archimate3.locationIcon',

  // Application layer
  'application-component':     'mxgraph.archimate3.component',
  'application-service':       'mxgraph.archimate3.service',
  'application-function':      'mxgraph.archimate3.function',
  'application-interaction':   'mxgraph.archimate3.interaction',
  'application-interface':     'mxgraph.archimate3.interface',
  'application-collaboration': 'mxgraph.archimate3.collaboration',
  'application-event':         'mxgraph.archimate3.event',
  'application-process':       'mxgraph.archimate3.process',
  'application-dataobject':    'mxgraph.archimate3.passive',

  // Technology layer
  'technology-device':                'mxgraph.archimate3.device',
  'technology-node':                  'mxgraph.archimate3.node',
  'technology-artifact':              'mxgraph.archimate3.artifact',
  'technology-systemsoftware':        'mxgraph.archimate3.sysSw',
  'technology-communicationnetwork':  'mxgraph.archimate3.network',
  'technology-path':                  'mxgraph.archimate3.path',
  'technology-service':               'mxgraph.archimate3.service',
  'technology-process':               'mxgraph.archimate3.process',
  'technology-function':              'mxgraph.archimate3.function',
  'technology-interaction':           'mxgraph.archimate3.interaction',
  'technology-event':                 'mxgraph.archimate3.event',
  'technology-interface':             'mxgraph.archimate3.interface',
  'technology-collaboration':         'mxgraph.archimate3.collaboration',

  // Motivation layer
  'motivation-stakeholder':  'mxgraph.archimate3.role',
  'motivation-driver':       'mxgraph.archimate3.driver',
  'motivation-assessment':   'mxgraph.archimate3.assess',
  'motivation-goal':         'mxgraph.archimate3.goal',
  'motivation-outcome':      'mxgraph.archimate3.outcome',
  'motivation-principle':    'mxgraph.archimate3.principle',
  'motivation-requirement':  'mxgraph.archimate3.requirement',
  'motivation-constraint':   'mxgraph.archimate3.constraint',
  'motivation-meaning':      'mxgraph.archimate3.meaning',
  'motivation-value':        'mxgraph.archimate3.value',

  // Strategy layer
  'strategy-capability':    'mxgraph.archimate3.capability',
  'strategy-courseofaction': 'mxgraph.archimate3.course',
  'strategy-resource':      'mxgraph.archimate3.resource',
  'strategy-valuestream':   'mxgraph.archimate3.valueStream',

  // Implementation layer
  'implementation-deliverable':  'mxgraph.archimate3.deliverable',
  'implementation-event':        'mxgraph.archimate3.event',
  'implementation-gap':          'mxgraph.archimate3.gapIcon',
  'implementation-plateau':      'mxgraph.archimate3.plateau',
  'implementation-workpackage':  'mxgraph.archimate3.workPackage',

  // Physical layer
  'technology-distributionnetwork': 'mxgraph.archimate3.distribution',
  'technology-equipment':           'mxgraph.archimate3.equipment',
  'technology-facility':            'mxgraph.archimate3.facility',
  'technology-material':            'mxgraph.archimate3.material',

  // Other
  'other-grouping': 'mxgraph.archimate3.grouping',
  'location':       'mxgraph.archimate3.locationIcon',

  // Junctions / Boundary / Grouping — no icon overlay
  'archimate-junction-and': null,
  'archimate-junction-or':  null,
  'archimate-boundary':     null,
  'archimate-grouping':     null,
  'archimate-group':        null,

  // Fallback — no icon
  'archimate': null,
};

/**
 * Canonical icon size for each mxgraph.archimate3.* shape, derived from
 * shape-defaults.json native dimensions scaled so max(w,h) = 15px.
 */
const ARCHIMATE3_ICON_SIZE: Record<string, [number, number]> = {
  // Standalone shapes (w×h from shape-defaults.json → scaled)
  'mxgraph.archimate3.actor':          [ 8, 15],
  'mxgraph.archimate3.application':    [15,  8],
  'mxgraph.archimate3.artifact':       [13, 15],
  'mxgraph.archimate3.assess':         [15, 15],
  'mxgraph.archimate3.businessObject': [15,  9],
  'mxgraph.archimate3.capability':     [15, 15],
  'mxgraph.archimate3.collaboration':  [15,  9],
  'mxgraph.archimate3.component':      [15, 13],
  'mxgraph.archimate3.constraint':     [15,  8],
  'mxgraph.archimate3.contract':       [15,  9],
  'mxgraph.archimate3.course':         [15, 15],
  'mxgraph.archimate3.deliverable':    [15,  11],
  'mxgraph.archimate3.device':         [15,  12],
  'mxgraph.archimate3.distribution':   [15,  6],
  'mxgraph.archimate3.driver':         [15, 15],
  'mxgraph.archimate3.equipment':      [15, 15],
  'mxgraph.archimate3.event':          [15,  9],
  'mxgraph.archimate3.facility':       [15, 10],
  'mxgraph.archimate3.function':       [15, 15],
  'mxgraph.archimate3.gapIcon':        [17, 15],
  'mxgraph.archimate3.goal':           [15, 15],
  'mxgraph.archimate3.grouping':       [15,  9],
  'mxgraph.archimate3.interaction':    [17, 15],
  'mxgraph.archimate3.interface':      [15,  8],
  'mxgraph.archimate3.locationIcon':   [15, 15],
  'mxgraph.archimate3.material':       [15, 13],
  'mxgraph.archimate3.meaning':        [15, 14],
  'mxgraph.archimate3.network':        [15, 13],
  'mxgraph.archimate3.node':           [15,  9],
  'mxgraph.archimate3.outcome':        [15, 15],
  'mxgraph.archimate3.passive':        [15,  9],
  'mxgraph.archimate3.path':           [15,  5],
  'mxgraph.archimate3.plateau':        [15, 10],
  'mxgraph.archimate3.principle':      [15, 15],
  'mxgraph.archimate3.process':        [15,  9],
  'mxgraph.archimate3.productSmall':   [15,  9],
  'mxgraph.archimate3.representation': [15,  9],
  'mxgraph.archimate3.requirement':    [15,  8],
  'mxgraph.archimate3.resource':       [15, 10],
  'mxgraph.archimate3.role':           [15,  9],
  'mxgraph.archimate3.service':        [15,  9],
  'mxgraph.archimate3.sysSw':          [15, 15],
  'mxgraph.archimate3.tech':           [15, 15],
  'mxgraph.archimate3.value':          [15, 10],
  'mxgraph.archimate3.valueStream':    [15,  8],
  'mxgraph.archimate3.workPackage':    [15, 13],
};

const BASE_ICON_SIZE = 15;

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

class ArchimateRenderer extends RichRenderer {
  protected shapeStyle: string;
  private icon: string | null;
  private iconExtraStyle: string;

  constructor(desc: RenderDescriptor, shapeStyle: string, icon: string | null, iconExtraStyle = '') {
    super(desc);
    this.shapeStyle = shapeStyle;
    this.icon = icon;
    this.iconExtraStyle = iconExtraStyle;
  }

  protected buildStyle(): string {
    let shape = this.shapeStyle || '';
    // Replace static dx with theme-derived cornerClip/2 for octagon shapes
    if (shape.includes('dx=')) {
      shape = shape.replace(/dx=\d+/, `dx=${this.theme.cornerClip / 2}`);
    }
    const parts = [
      shape,
      'whiteSpace=wrap', 'html=1',
      `fontStyle=1`, `fontSize=${this.theme.fontSize}`,
      'align=center', 'verticalAlign=top',
      `spacingTop=${Math.round(this.theme.spacingTop)}`,
      `fillColor=none`, `strokeColor=${this.theme.colorDark}`, `fontColor=${this.theme.colorDark}`,
      `strokeWidth=${this.theme.strokeWidth}`,
      'collapsible=0', 'container=1',
    ].filter(Boolean);
    // Add standard rounded corners for plain-rect and dashed-rect frames;
    // skip shapes that already define rounded or use a non-rect shape.
    if (!shape.includes('rounded') && !shape.includes('shape=')) {
      parts.push(`rounded=1`, `absoluteArcSize=1`, `arcSize=${this.theme.arcSize}`);
    } else if (shape.includes('rounded') && !shape.includes('arcSize')) {
      // Rounded archimate shapes (service, process, function, etc.) — absolute pixels
      parts.push(`absoluteArcSize=1`, `arcSize=${this.theme.largeArcSize}`);
    }
    return parts.join(';') + ';';
  }

  // Top-right icon area acts as a titlebar
  protected shapePadding(): ShapePadding { return {}; }
  protected override get hasTitlebar(): boolean { return true; }
  protected override get titleAreaHeight(): number {
    const extraLines = Math.max(0, this.label.split('\n').length - 1);
    return this.theme.portSize + extraLines * this.theme.fontSize * 1.2;
  }

  // Cat 2: has title area (icon) but no title container border.
  // With label: label bottom + groupPad.  Without label: reserve minimum height.
  override get groupTopPadding(): number {
    const lines = this.label ? this.label.split('\n').length : 0;
    if (lines > 0) {
      const labelH = lines * this.theme.fontSize * 1.2;
      return this.theme.groupPad + this.labelSpacingTop + labelH;
    }
    return this.theme.groupPad + this.theme.titleBarH;
  }

  render(box: ContentBox): string[] {
    const cells = super.render(box);
    if (this.icon) {
      // Scale icon dimensions from BASE_ICON_SIZE table to theme.sizeS.
      const [bw, bh] = ARCHIMATE3_ICON_SIZE[this.icon] ?? [BASE_ICON_SIZE, BASE_ICON_SIZE];
      const iw = bw * this.theme.spotSize / BASE_ICON_SIZE * 0.8;
      const ih = bh * this.theme.spotSize / BASE_ICON_SIZE * 0.8;
      // Vertically center the icon within the titlebar band.
      const iy = this.theme.edgeGap + (this.theme.spotSize - ih) / 2;
      // For 'archimate' keyword nodes the icon is horizontally centered;
      // for all other archimate nodes it sits at the top-right corner.
      const ix = this.desc.centeredIcon
        ? (box.width - iw) / 2
        : box.width - this.theme.edgeGap - (this.theme.spotSize + iw) / 2;
      // Resolve icon stroke color from inline style override
      const parsedStyle = parseNodeStyle(this.desc.style);
      const iconStroke = parsedStyle?.strokeColor || this.theme.colorDark;
      cells.push(mxVertex({
        id: `${this.id}__icon`,
        value: '',
        style: `shape=${this.icon};fillColor=none;strokeColor=${iconStroke};strokeWidth=${this.theme.strokeWidth};${this.iconExtraStyle}`,
        parent: this.id,
        x: ix,
        y: iy,
        width: iw,
        height: ih,
      }));
    }
    return cells;
  }
}

/**
 * Folder-shaped archimate renderer for Group / Grouping.
 * Uses DrawIO built-in `shape=folder` so the frame renders as a folder.
 * @param fillColor   fill for the folder body
 * @param extraStyle  extra style string appended (e.g. dashed)
 */
class FolderArchimateRenderer extends ArchimateRenderer {
  private folderFill: string;

  constructor(desc: RenderDescriptor, folderFill: string, extraStyle = '') {
    // Pass extraStyle as part of shapeStyle so buildStyle() picks it up.
    // Compute dynamic tab height for multi-line labels
    const lines = (desc.label ?? '').split('\n');
    const tabH = lines.length > 1
      ? Math.ceil(lines.length * desc.theme.fontSize * 1.2 + desc.theme.padXS * 2)
      : desc.theme.tabH;
    super(desc, `shape=folder;tabWidth=${desc.theme.tabMinW};tabHeight=${tabH};tabPosition=left;${extraStyle}`, null, '');
    this.folderFill = folderFill;
  }

  protected override buildStyle(): string {
    const shape = this.shapeStyle || '';
    const parts = [
      shape,
      `rounded=1`, `absoluteArcSize=1`, `arcSize=${this.theme.arcSize}`,
      'whiteSpace=wrap', 'html=1',
      `fontStyle=1`, `fontSize=${this.theme.fontSize}`,
      'align=center', 'verticalAlign=top',
      `spacingTop=${Math.round(this.theme.spacingTop)}`,
      `fillColor=${this.folderFill}`, `strokeColor=${this.theme.colorDark}`, `fontColor=${this.theme.colorDark}`,
      `strokeWidth=${this.theme.strokeWidth}`,
      'collapsible=0', 'container=1',
    ].filter(Boolean);
    return parts.join(';') + ';';
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Create an ArchimateRenderer instance for reuse by other shape modules. */
export function createArchimateRenderer(desc: RenderDescriptor, shapeStyle: string, icon: string | null, iconExtraStyle = '') {
  return new ArchimateRenderer(desc, shapeStyle, icon, iconExtraStyle);
}

export function registerArchimateShapes(): void {
  for (const [stereotype, style] of Object.entries(ARCHIMATE_STYLE_MAP)) {
    const icon = ARCHIMATE_ICON_MAP[stereotype] ?? null;
    const iconExtraStyle = stereotype === 'other-grouping' ? 'dashed=1;dashPattern=1 1;' : '';
    if (stereotype === 'archimate-junction-and' || stereotype === 'archimate-junction-or') {
      const fill = style.match(/fillColor=([^;]+)/)?.[1] ?? '#FFFFFF';
      const stroke = style.match(/strokeColor=([^;]+)/)?.[1] ?? '#181818';
      registerRenderer(stereotype, (desc: RenderDescriptor) => new JunctionRenderer(desc, fill, stroke));
    } else if (stereotype === 'archimate-group') {
      registerRenderer(stereotype, (desc: RenderDescriptor) => new FolderArchimateRenderer(desc, '#D3D3D3'));
    } else if (stereotype === 'archimate-grouping') {
      registerRenderer(stereotype, (desc: RenderDescriptor) => new FolderArchimateRenderer(desc, '#FFFFFF', 'dashed=1;dashPattern=8 5;'));
    } else {
      registerRenderer(stereotype, (desc: RenderDescriptor) => new ArchimateRenderer(desc, style, icon, iconExtraStyle));
    }
  }
}
