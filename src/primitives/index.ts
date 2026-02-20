/**
 * Barrel export for all rendering primitives.
 *
 * All renderer creation goes through the global registry.
 * Modules register their factories at import time via registerXxx().
 * No classes or custom factory functions are exported from individual modules.
 */

// ── Renderer base class + options types ──────────────────────────────────────
export { Renderer, RichBodyRenderer, SwimlaneRenderer } from './renderer.ts';
export type { NodeRenderer, ClassNodeRendererOpts, NoteRendererOpts, DotContext } from './renderer.ts';

// ── Global registry API re-exports ───────────────────────────────────────────
export { createRenderer } from './registry.ts';
export type { RenderDescriptor, NodeDescriptor, ElementDescriptor } from './registry.ts';

// ── Registration calls — import each module to trigger registration ──────────
import { registerCircleNodeRenderer } from './circle-node.ts';
import { registerDiamondNodeRenderer } from './diamond-node.ts';
import { registerBracketNodeRenderer } from './bracket-node.ts';
import { registerClassNodeRenderer } from './class-node.ts';
import { registerMapNodeRenderer } from './map-node.ts';
import { registerStateNodeRenderers } from './state-node.ts';
import { registerUsecaseShape } from './shapes/usecase.ts';
import { registerActorNodeRenderer } from './actor-node.ts';
import { registerActivityNodeRenderer } from './activity-node.ts';
import { registerFolderShape } from './shapes/folder.ts';
import { registerRectangleShape } from './shapes/rectangle.ts';
import { registerNodeCubeShape } from './shapes/node-cube.ts';
import { registerFrameShape as registerFrameShapeShape } from './shapes/frame.ts';
import { registerCloudShape } from './shapes/cloud.ts';
import { registerDatabaseShape } from './shapes/database.ts';
import { registerAgentShape } from './shapes/agent.ts';
import { registerStorageShape } from './shapes/storage.ts';
import { registerComponentShape } from './shapes/component.ts';
import { registerArtifactShape } from './shapes/artifact.ts';
import { registerCardShape } from './shapes/card.ts';
import { registerBoundaryShape } from './shapes/boundary.ts';
import { registerControlShape } from './shapes/control.ts';
import { registerFileShape } from './shapes/file.ts';
import { registerHexagonShape } from './shapes/hexagon.ts';
import { registerLabelShape } from './shapes/label.ts';
import { registerPersonShape } from './shapes/person.ts';
import { registerQueueShape } from './shapes/queue.ts';
import { registerStackShape } from './shapes/stack.ts';
import { registerCollectionsShape } from './shapes/collections.ts';
import { registerEntityShape } from './shapes/entity.ts';
import { registerNoteRenderer } from './note.ts';
import { registerLegendRenderer } from './legend.ts';
import { registerTitleRenderer } from './title.ts';
import { registerBoxRenderer } from './box.ts';

// Execute all registrations
registerCircleNodeRenderer();
registerDiamondNodeRenderer();
registerBracketNodeRenderer();
registerClassNodeRenderer();
registerMapNodeRenderer();
registerStateNodeRenderers();
registerUsecaseShape();
registerActorNodeRenderer();
registerActivityNodeRenderer();
registerFolderShape();
registerRectangleShape();
registerNodeCubeShape();
registerFrameShapeShape();
registerCloudShape();
registerDatabaseShape();
registerAgentShape();
registerStorageShape();
registerComponentShape();
registerArtifactShape();
registerCardShape();
registerBoundaryShape();
registerControlShape();
registerFileShape();
registerHexagonShape();
registerLabelShape();
registerPersonShape();
registerQueueShape();
registerStackShape();
registerCollectionsShape();
registerEntityShape();
registerNoteRenderer();
registerLegendRenderer();
registerTitleRenderer();
registerBoxRenderer();

// ── Unified node factory (dispatches via registry) ───────────────────────────
import { createRenderer } from './registry.ts';
import type { RenderDescriptor } from './registry.ts';
import type { Renderer as RendererType } from './renderer.ts';

/** Bracket body component types (deployment entities with rich body content). */
const BRACKET_BODY_TYPES = new Set([
  'node', 'rectangle', 'file', 'person', 'card', 'cloud',
  'component', 'artifact', 'folder', 'frame', 'hexagon',
  'stack', 'storage', 'agent', 'database', 'usecase',
]);

/** Standalone deployment shapes (no body — rendered by per-shape renderers). */
const DEPLOYMENT_SHAPES = new Set([
  'folder', 'rectangle', 'rect', 'node', 'frame', 'cloud', 'database',
  'agent', 'storage', 'component', 'component1', 'component2',
  'artifact', 'card',
  'boundary', 'control', 'entity', 'file', 'hexagon', 'label',
  'package', 'person', 'queue', 'stack', 'collections', 'usecase',
]);

/**
 * Create the appropriate Renderer for a semantic node.
 * Dispatches to the correct registered factory based on node type/stereotype.
 */
export function createNodeRenderer(desc: RenderDescriptor): RendererType {
  const stype = desc.stereotype || desc.type || '';
  const ntype = desc.type || '';

  // State diagram special nodes
  if (['state_start', 'state_end', 'state_fork', 'state_join', 'state_choice', 'state'].includes(ntype)) {
    return createRenderer(ntype, desc);
  }

  // Use-case diagram nodes
  if (ntype === 'usecase') return createRenderer('usecase', desc);
  if (ntype === 'usecase_actor') return createRenderer('usecase_actor', desc);

  // Activity diagram nodes
  if (stype === 'activity') return createRenderer('activity', desc);

  // Special stereotypes
  if (stype === 'circle' || stype === 'interface') return createRenderer('circle', desc);
  if (stype === 'diamond') return createRenderer('diamond', desc);

  // Map nodes
  if (desc.mapEntries && desc.mapEntries.length > 0) {
    return createRenderer('map', desc);
  }

  // Bracket body (deployment entities with rich body)
  if (BRACKET_BODY_TYPES.has(stype) && desc.bodyLines && desc.bodyLines.length > 0) {
    return createRenderer('bracket', desc);
  }

  // Standalone deployment shapes (no body content)
  if (DEPLOYMENT_SHAPES.has(stype)) {
    return createRenderer(stype, desc);
  }

  // Default: class/interface/enum swimlane node
  return createRenderer('class', desc);
}

// ── Legacy group exports (still needed by some consumers) ────────────────────
export { buildClusterDotBlock } from './group.ts';

// Shared label builder
export { buildLabelHtml } from './label.ts';

// Class diagram primitives (non-factory exports still needed by consumers)
export {
  buildTitleHtml,
  computeTitleH,
  classNodeStyle,
  textRowStyle,
  separatorStyle,
  ROW_HEIGHT,
  SEPARATOR_HEIGHT,
} from './class-node.ts';

// Note primitives
export {
  noteStyle,
} from './note.ts';

// Sequence diagram primitives
export {
  PARTICIPANT_CONFIG,
  ICON_MIN_WIDTH,
  ICON_HEIGHT,
  buildParticipantLabel,
  participantCellGeom,
  participantStyle,
  renderParticipant,
  renderFootbox,
} from './participant.ts';

export {
  messageStyle,
} from './message.ts';

export {
  renderDestroyMarker,
  activationBarStyle,
  renderActivationBar,
} from './activation.ts';

export {
  renderFragment,
} from './fragment.ts';

export {
  renderDivider,
} from './divider.ts';

export {
  renderDurationConstraint,
} from './duration-constraint.ts';

// ── Global renderer factory ──────────────────────────────────────────────────
import { createRenderer as createRendererFn } from './registry.ts';
import type { SemanticModel } from '../model/class-model.ts';
import { Renderer as RendererBase } from './renderer.ts';

/**
 * Create renderers for model-level (global) elements: title, legend.
 * Uses the global registry — no direct factory references.
 */
export function createGlobalRenderers(model: SemanticModel): Map<string, RendererBase> {
  const map = new Map<string, RendererBase>();
  if (model.title) {
    map.set('__title__', createRendererFn('title', { id: '__title__', label: model.title }));
  }
  if (model.legend) {
    map.set('__legend__', createRendererFn('legend', { id: '__legend__', lines: model.legend.text.split('\n'), align: model.legend.align }));
  }
  return map;
}
