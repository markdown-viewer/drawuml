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
import { Content } from '../../shared/content.ts';
import { mxVertex } from '../../shared/xml-utils.ts';
import { parseNodeStyle } from '../../shared/color-utils.ts';
import { COLOR_DARK, DEFAULT_FONT_SIZE, RECT_ARC_SIZE } from '../../shared/theme.ts';
import { registerRenderer } from '../registry.ts';
import type { RenderDescriptor } from '../registry.ts';
import type { ContentBox } from '../../shared/content.ts';

// Junction geometry constants (same pattern as actor / boundary)
const JUNCTION_SIZE     = 16;  // circle diameter
const JUNCTION_TEXT_GAP = 4;   // gap between circle and label
const MIN_JUNCTION_TEXT_H = 18;  // minimum label area height (single-line floor)
const JUNCTION_PAD_X    = 20;  // horizontal padding for label

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
  'business-service':        'rounded=1;arcSize=25',
  'business-process':        'rounded=1;arcSize=25',
  'business-function':       'rounded=1;arcSize=25',
  'business-interaction':    'rounded=1;arcSize=25',
  'business-event':          'rounded=1;arcSize=25',
  'business-interface':      '',
  'business-collaboration':  '',
  'business-object':         '',
  'business-product':        '',
  'business-representation': '',
  'business-contract':       '',
  'business-location':       '',

  // Application layer
  'application-component':     '',
  'application-service':       'rounded=1;arcSize=25',
  'application-function':      'rounded=1;arcSize=25',
  'application-interaction':   'rounded=1;arcSize=25',
  'application-interface':     '',
  'application-collaboration': '',
  'application-event':         'rounded=1;arcSize=25',
  'application-process':       'rounded=1;arcSize=25',
  'application-dataobject':    '',

  // Technology layer
  'technology-device':                '',
  'technology-node':                  '',
  'technology-artifact':              '',
  'technology-systemsoftware':        '',
  'technology-communicationnetwork':  '',
  'technology-path':                  '',
  'technology-service':               'rounded=1;arcSize=25',
  'technology-process':               'rounded=1;arcSize=25',
  'technology-function':              'rounded=1;arcSize=25',
  'technology-interaction':           'rounded=1;arcSize=25',
  'technology-event':                 'rounded=1;arcSize=25',
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
  'strategy-capability':    'rounded=1;arcSize=25',
  'strategy-courseofaction': 'rounded=1;arcSize=25',
  'strategy-resource':      '',
  'strategy-valuestream':   'rounded=1;arcSize=25',

  // Implementation layer
  'implementation-deliverable':  '',
  'implementation-event':        'rounded=1;arcSize=25',
  'implementation-gap':          '',
  'implementation-plateau':      '',
  'implementation-workpackage':  'rounded=1;arcSize=25',

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
  'mxgraph.archimate3.gapIcon':        [15, 14],
  'mxgraph.archimate3.goal':           [15, 15],
  'mxgraph.archimate3.grouping':       [15,  9],
  'mxgraph.archimate3.interaction':    [15, 15],
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
    const shape = this.shapeStyle || '';
    const parts = [
      shape,
      'whiteSpace=wrap', 'html=1',
      `fontStyle=1`, `fontSize=${DEFAULT_FONT_SIZE}`,
      'align=center', 'verticalAlign=middle',
      'spacingTop=2',
      `fillColor=none`, `strokeColor=${COLOR_DARK}`, `fontColor=${COLOR_DARK}`,
      'collapsible=0', 'container=1',
    ].filter(Boolean);
    // Add standard rounded corners for plain-rect and dashed-rect frames;
    // skip shapes that already define rounded or use a non-rect shape.
    if (!shape.includes('rounded') && !shape.includes('shape=')) {
      parts.push(`rounded=1`, `absoluteArcSize=1`, `arcSize=${RECT_ARC_SIZE}`);
    }
    return parts.join(';') + ';';
  }

  // Top-right icon area height ~20px; content (label) starts below the icon
  protected get topPadY(): number { return 20; }

  // No fixed title area — use RichRenderer default (label-based detection)

  render(box: ContentBox): string[] {
    const cells = super.render(box);
    if (this.icon) {
      // Look up icon dimensions (aspect-ratio-correct, max-dim=15).
      const [iw, ih] = ARCHIMATE3_ICON_SIZE[this.icon] ?? [15, 15];
      // Vertically center the icon within the topPadY band.
      const iy = Math.round((this.topPadY - ih) / 2);
      // For 'archimate' keyword nodes the icon is horizontally centered;
      // for all other archimate nodes it sits at the top-right corner.
      const ix = this.desc.centeredIcon
        ? Math.round((box.width - iw) / 2)
        : box.width - iw - 8;
      // Resolve icon stroke color from inline style override
      const parsedStyle = parseNodeStyle(this.desc.style);
      const iconStroke = parsedStyle?.strokeColor || COLOR_DARK;
      cells.push(mxVertex({
        id: `${this.id}__icon`,
        value: '',
        style: `shape=${this.icon};fillColor=none;strokeColor=${iconStroke};${this.iconExtraStyle}`,
        parent: this.id,
        x: ix,
        y: iy + 3,
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
    super(desc, `shape=folder;tabWidth=42;tabHeight=20;tabPosition=left;${extraStyle}`, null, '');
    this.folderFill = folderFill;
  }

  protected override buildStyle(): string {
    const shape = this.shapeStyle || '';
    const parts = [
      shape,
      `rounded=1`, `absoluteArcSize=1`, `arcSize=${RECT_ARC_SIZE}`,
      'whiteSpace=wrap', 'html=1',
      `fontStyle=1`, `fontSize=${DEFAULT_FONT_SIZE}`,
      'align=center', 'verticalAlign=middle',
      'spacingTop=2',
      `fillColor=${this.folderFill}`, `strokeColor=${COLOR_DARK}`, `fontColor=${COLOR_DARK}`,
      'collapsible=0', 'container=1',
    ].filter(Boolean);
    return parts.join(';') + ';';
  }
}

/** Junction renderer: small circle with label below (same pattern as actor / boundary). */
class JunctionRenderer extends ArchimateRenderer {
  protected override get topPadY(): number { return 0; }

  protected override doMeasure() {
    // Full bounding box = circle + gap + label, so DOT allocates correct spacing.
    const labelSize = Content.inline(this.desc.label ?? '').measure();
    const labelH = Math.max(Math.ceil(labelSize.height), MIN_JUNCTION_TEXT_H);
    return {
      width:  Math.max(JUNCTION_SIZE, labelSize.width + JUNCTION_PAD_X),
      height: JUNCTION_SIZE + JUNCTION_TEXT_GAP + labelH,
    };
  }

  override get nodeLabel(): string { return this.desc.label ?? ''; }

  override graphicCenterOffset() {
    // Circle center is at JUNCTION_SIZE/2 from top; geometric center is height/2.
    const h = this.measure().height;
    return { dx: 0, dy: JUNCTION_SIZE / 2 - h / 2 };
  }

  override render(box: ContentBox): string[] {
    const fill   = this.shapeStyle.match(/fillColor=([^;]+)/)?.[1] ?? '#FFFFFF';
    const stroke = this.shapeStyle.match(/strokeColor=([^;]+)/)?.[1] ?? COLOR_DARK;
    const style = [
      'ellipse',
      `fillColor=${fill}`,
      `strokeColor=${stroke}`,
      `fontColor=${COLOR_DARK}`,
      'verticalLabelPosition=bottom',
      'verticalAlign=top',
      'align=center',
      'html=1',
      `fontSize=${DEFAULT_FONT_SIZE}`,
    ].join(';') + ';';
    // Center the circle horizontally; place at top of the DOT bounding box.
    const cx = box.x + Math.round((box.width - JUNCTION_SIZE) / 2);
    return [mxVertex({
      id: this.id,
      value: this.content.html,
      style,
      parent: this.parentId || '1',
      x: cx, y: box.y, width: JUNCTION_SIZE, height: JUNCTION_SIZE,
    })];
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
      registerRenderer(stereotype, (desc: RenderDescriptor) => new JunctionRenderer(desc, style, null));
    } else if (stereotype === 'archimate-group') {
      registerRenderer(stereotype, (desc: RenderDescriptor) => new FolderArchimateRenderer(desc, '#D3D3D3'));
    } else if (stereotype === 'archimate-grouping') {
      registerRenderer(stereotype, (desc: RenderDescriptor) => new FolderArchimateRenderer(desc, '#FFFFFF', 'dashed=1;dashPattern=8 5;'));
    } else {
      registerRenderer(stereotype, (desc: RenderDescriptor) => new ArchimateRenderer(desc, style, icon, iconExtraStyle));
    }
  }
}
