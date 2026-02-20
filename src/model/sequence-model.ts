/**
 * Sequence diagram specific model types.
 */
import type { NodeTypeName } from './common.ts';

export interface SequenceParticipant {
  id: string;
  type: NodeTypeName;
  /** Raw PlantUML label text (Creole markup, NOT pre-processed HTML). */
  label: string;
  /** Bracket body lines for multiline participant labels (e.g. participant P [ ... ]). */
  bracketLines?: string[];
  alias?: string;
  order?: number;          // explicit ordering via `order` keyword
  color?: string;          // background color (#xxx)
  createdAtRow?: number;   // row index where participant is created via ** decor
  destroyedAtRow?: number; // row index where participant is destroyed via !! decor
}

export interface SequenceMessage {
  from: string;
  to: string;
  /** Raw PlantUML label text (Creole markup, NOT pre-processed HTML). */
  label: string;
  /** Raw autonumber prefix text (NOT pre-processed HTML). */
  numberPrefix?: string;
  arrowStyle: SequenceArrowStyle;
  activate?: boolean;      // ++ shorthand
  deactivate?: boolean;    // -- shorthand
  activateColor?: string;
  decor?: string;          // ** (create) or !! (destroy)
}

export interface SequenceArrowStyle {
  token: string;
  startHeadToken: string;
  endHeadToken: string;
  bodyToken: string;
  lineStyle: 'solid' | 'dashed';     // - vs --
  arrowHead: string;  // resolved render head style
  direction: 'left' | 'right';      // arrow direction
  color?: string;                    // arrow color from [#color] syntax
}

export interface SequenceActivation {
  participant: string;
  startRow: number;     // message row index
  endRow: number;       // message row index
  color?: string;
  destroyed?: boolean;  // ends with destroy (X marker)
}

export interface SequenceFragment {
  type: string;           // alt, loop, opt, par, break, group, ref, ...
  /** Raw PlantUML label text (Creole markup, NOT pre-processed HTML). */
  label: string;
  startRow: number;
  endRow: number;
  sections?: { label: string; startRow: number }[];   // else sections in alt
}

export interface SequenceDivider {
  /** Raw PlantUML label text (Creole markup, NOT pre-processed HTML). */
  label: string;
  row: number;
}

export interface SequenceDurationConstraint {
  /** Raw PlantUML label text (Creole markup, NOT pre-processed HTML). */
  label: string;
  fromTag: string;
  toTag: string;
  startRow: number;
  endRow: number;
  participants: string[];  // participants involved (from, to) for x positioning
}

export interface SequenceNote {
  /** Raw PlantUML text (unprocessed, NOT HTML). Lines separated by \n. */
  text: string;
  position: 'left' | 'right' | 'over';
  participants: string[];    // one or two participant ids
  row: number;
  noteType?: string;         // 'note' | 'hnote' | 'rnote'
  color?: string;            // fill color override
}

export interface SequenceModel {
  diagramType: 'sequence';
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  activations: SequenceActivation[];
  fragments: SequenceFragment[];
  dividers: SequenceDivider[];
  durationConstraints: SequenceDurationConstraint[];
  notes: SequenceNote[];
  hideFootbox?: boolean;
  /** Horizontal alignment for participant bracket body content ('left' | 'center' | 'right'). */
  participantAlign?: 'left' | 'center' | 'right';
  /** Raw PlantUML title text (Creole markup, NOT pre-processed HTML). */
  title?: string;
}
