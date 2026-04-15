/**
 * Class diagram specific model types.
 */
import type { DiagramTypeName, NodeTypeName, EdgeTypeName, ArrowMetaParts } from './common.ts';
import type { NormalizedBodyBlock, NormalizedRichBlock } from './normalized-rich-text.ts';

/** A single body line: plain string or tagged ({field}/{method}) entry parsed by PEG. */
export type BodyLine = string | { text: string; tag: string };

export interface SemanticNode {
  id: string;
  type: NodeTypeName;
  /** Raw PlantUML label text (Creole markup, NOT pre-processed HTML). */
  label: string;
  /** Normalized HTML label, produced by the text normalization pass. */
  labelHtml?: string;
  stereotype?: string | null;
  stereotypeLabel?: string;
  /** Raw body lines (unprocessed PlantUML text) for class body rendering. */
  bodyLines?: BodyLine[];
  /** Structured normalized body blocks, produced by the text normalization pass. */
  bodyBlocks?: NormalizedBodyBlock[];
  /** Raw PlantUML style string, e.g. "#palegreen ##[dashed]green" or "#back:red;line:00FFFF" */
  style?: string | null;
  /** Custom spot override from stereotype syntax, e.g. <<(S,#FF7700) Singleton>> */
  spot?: { char: string; color: string };
  /** When true, suppress the spot circle in the title area (from "hide circle" directive). */
  hideCircle?: boolean;
  /** When true, hide field lines in the body (from "hide fields" directive). */
  hideFields?: boolean;
  /** When true, hide method lines in the body (from "hide methods" directive). */
  hideMethods?: boolean;
  /** Map entries for "map" blocks (key => value table rows). */
  mapEntries?: { key: string; value: string; linked?: boolean; keyHtml?: string; valueHtml?: string }[];
  /** Generic type parameter text, e.g. "? extends Element". */
  generic?: string;
  /** User-defined $tags from class declaration syntax. */
  tags?: string[];
  /** Whether this node is a port (port/portin/portout). */

  isPort?: boolean;
  /** Port direction: 'portin' for input/bidirectional, 'portout' for output. */
  portType?: 'portin' | 'portout';
  /** When true, the archimate icon overlay is horizontally centered (used by 'archimate' keyword nodes). */
  centeredIcon?: boolean;
  /** AWS4 composite icon overlay stencil key, e.g. 'mxgraph.aws4.api_gateway'. */
  resIcon?: string;
  /** AWS4 composite icon background fill color, e.g. '#E7157B'. */
  fillColor?: string;
  /** AWS4 composite icon background stroke color, e.g. '#ffffff'. */
  strokeColor?: string;
}

export interface SemanticEdge {
  id: string;
  type: EdgeTypeName;
  from: string;
  to: string;
  arrow?: string;
  arrowMeta?: ArrowMetaParts | null;
  label?: string;
  labelHtml?: string;
  cardFrom?: string;
  cardFromHtml?: string;
  cardTo?: string;
  cardToHtml?: string;
  /** Raw PlantUML inline style on the edge, e.g. "#line:red;line.bold;text:red" */
  style?: string | null;
  /** Field-level port on the source node (e.g. "字段1" from "Foo::字段1") */
  fromPort?: string;
  /** Field-level port on the target node (e.g. "字段3" from "Bar::字段3") */
  toPort?: string;
  /** Direction hint from arrow syntax (-left->, -right->, -up->, -down->) */
  direction?: 'left' | 'right' | 'up' | 'down' | null;
  /** Arrow length — number of line chars. Affects DOT minlen. */
  length?: number;
}

export interface ClassNote {
  id: string;
  /** Raw PlantUML text (unprocessed, NOT HTML). Lines separated by \n. */
  text: string;
  /** Normalized HTML note body, produced by the text normalization pass. */
  textHtml?: string;
  /** Structured normalized blocks for note body, preserving separators. */
  richBlocks?: NormalizedRichBlock[];
  position?: string;      // 'top' | 'left' | 'right' | 'bottom'
  target?: string;        // node id this note is attached to
  memberTarget?: string;  // full member-level target, e.g. "A::counter"
  floating?: boolean;     // floating note ("note ... as N1")
  onLink?: boolean;       // "note on link" — note attached to an edge
  linkEdgeId?: string;    // edge id this link-note is attached to
  color?: string;         // background color override, e.g. "#red"
}

export interface ClassLegend {
  /** Raw PlantUML text (unprocessed, NOT HTML). Lines separated by \n. */
  text: string;
  /** Normalized HTML legend body, produced by the text normalization pass. */
  textHtml?: string;
  /** Structured normalized blocks for legend body, preserving separators. */
  richBlocks?: NormalizedRichBlock[];
  align?: string;         // 'left' | 'center' | 'right' (default: 'center')
}

/**
 * A container group (package / namespace / rectangle / frame / folder / …).
 */
export interface SemanticGroup {
  id: string;
  label: string;
  labelHtml?: string;
  type: string;           // 'package' | 'namespace' | 'rectangle' | 'frame' | 'folder' | ...
  stereotype?: string;    // package shape stereotype: 'Node' | 'Rectangle' | 'Folder' | 'Frame' | 'Cloud' | 'Database' | ...
  alias?: string;         // optional alias for edge resolution (e.g. "as LB")
  parentId?: string;      // parent group id (nested packages)
  children: string[];     // child node ids
  childGroups: string[];  // child group ids
  color?: string;         // background fill color override (normalized hex)
  style?: string | null;  // raw PlantUML inline style string
  /** Concurrent regions within state groups ("--" / "||" separators)
   *  or swimlane groups in activity diagrams.
   *  Each sub-array contains the child node IDs belonging to that region. */
  concurrentRegions?: string[][];
  /** Labels for concurrent regions (parallel array to concurrentRegions). */
  concurrentRegionLabels?: string[];
  /** Background colors for concurrent regions (parallel array). */
  concurrentRegionColors?: string[];
}

export interface SemanticModel {
  diagramType: DiagramTypeName;
  /** Diagram context for stereotype-to-shape resolution (class, deployment, state, etc.). */
  diagramContext?: string;
  nodes: SemanticNode[];
  edges: SemanticEdge[];
  notes?: ClassNote[];
  groups?: SemanticGroup[];
  /** Diagram title ("title ..."). */
  title?: string;
  /** Normalized HTML title, produced by the text normalization pass. */
  titleHtml?: string;
  /** Legend block ("legend ... end legend"). */
  legend?: ClassLegend;
  /** DOT rankdir override: 'TB' | 'BT' | 'LR' | 'RL'. Default: 'BT'. */
  rankdir?: string;
  /** Collected skinparam key-value pairs. */
  skinparams?: Record<string, string>;
}
