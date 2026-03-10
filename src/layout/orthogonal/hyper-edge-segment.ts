/**
 * Translated from ELK: HyperEdgeSegment.java
 * Copyright (c) 2010, 2020 Kiel University and others. EPL-2.0
 *
 * Represents the "trunk" of a hyper edge — in TB layouts this is the horizontal
 * segment between two layers. The segment has sorted incoming/outgoing connection
 * coordinates that determine its extent (startPosition..endPosition).
 */
import type { HyperEdgeSegmentDependency } from './hyper-edge-segment-dependency.ts';

export class HyperEdgeSegment {
  // -- mark used for cycle breaking --
  mark: number = 0;

  // -- routing slot determines distance to preceding layer --
  routingSlot: number = 0;

  // -- extent --
  startPosition: number = NaN;
  endPosition: number = NaN;

  // -- sorted connection coordinates --
  readonly incomingConnectionCoordinates: number[] = [];
  readonly outgoingConnectionCoordinates: number[] = [];

  // -- dependency lists --
  readonly outgoingSegmentDependencies: HyperEdgeSegmentDependency[] = [];
  outDepWeight: number = 0;
  criticalOutDepWeight: number = 0;
  readonly incomingSegmentDependencies: HyperEdgeSegmentDependency[] = [];
  inDepWeight: number = 0;
  criticalInDepWeight: number = 0;

  // -- split information --
  splitPartner: HyperEdgeSegment | null = null;
  splitBy: HyperEdgeSegment | null = null;

  // -- edges belonging to this segment (for bend point generation) --
  readonly edgeIds: string[] = [];

  // -- source/target port positions per edge (for bend point calculation) --
  // key: edgeId, value: { sourcePos, targetPos } — the coordinate on the segment axis
  readonly edgePortPositions: Map<string, { sourcePos: number; targetPos: number }> = new Map();

  getLength(): number {
    return this.endPosition - this.startPosition;
  }

  representsHyperedge(): boolean {
    return this.incomingConnectionCoordinates.length + this.outgoingConnectionCoordinates.length > 2;
  }

  isDummy(): boolean {
    return this.splitPartner !== null && this.splitBy === null;
  }

  recomputeExtent(): void {
    this.startPosition = NaN;
    this.endPosition = NaN;
    this._recomputeExtentFromList(this.incomingConnectionCoordinates);
    this._recomputeExtentFromList(this.outgoingConnectionCoordinates);
  }

  private _recomputeExtentFromList(positions: number[]): void {
    if (positions.length === 0) return;
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (isNaN(this.startPosition)) {
      this.startPosition = first;
    } else {
      this.startPosition = Math.min(this.startPosition, first);
    }
    if (isNaN(this.endPosition)) {
      this.endPosition = last;
    } else {
      this.endPosition = Math.max(this.endPosition, last);
    }
  }

  /**
   * Simulates what would happen during a split. Returns [splitSegment, splitPartner].
   */
  simulateSplit(): [HyperEdgeSegment, HyperEdgeSegment] {
    const newSplit = new HyperEdgeSegment();
    const newSplitPartner = new HyperEdgeSegment();

    newSplit.incomingConnectionCoordinates.push(...this.incomingConnectionCoordinates);
    newSplit.splitBy = this.splitBy;
    newSplit.splitPartner = newSplitPartner;
    newSplit.recomputeExtent();

    newSplitPartner.outgoingConnectionCoordinates.push(...this.outgoingConnectionCoordinates);
    newSplitPartner.splitPartner = newSplit;
    newSplitPartner.recomputeExtent();

    return [newSplit, newSplitPartner];
  }

  /**
   * Splits this segment into two and returns the new segment. This segment retains
   * all incoming connection coordinates; outgoing ones move to the split partner.
   * The two segments are linked at splitPosition. All dependencies are cleared.
   */
  splitAt(splitPosition: number): HyperEdgeSegment {
    this.splitPartner = new HyperEdgeSegment();
    this.splitPartner.splitPartner = this;

    // Move all target positions over to the new segment
    this.splitPartner.outgoingConnectionCoordinates.push(...this.outgoingConnectionCoordinates);
    this.outgoingConnectionCoordinates.length = 0;

    // Link the two
    this.outgoingConnectionCoordinates.push(splitPosition);
    this.splitPartner.incomingConnectionCoordinates.push(splitPosition);

    // Recompute their outer coordinates
    this.recomputeExtent();
    this.splitPartner.recomputeExtent();

    // Clear dependencies
    while (this.incomingSegmentDependencies.length > 0) {
      this.incomingSegmentDependencies[0].remove();
    }
    while (this.outgoingSegmentDependencies.length > 0) {
      this.outgoingSegmentDependencies[0].remove();
    }

    return this.splitPartner;
  }
}

/**
 * Insert a value into a sorted list, maintaining ascending order.
 * Duplicates (exact matches) are skipped.
 */
export function insertSorted(list: number[], value: number): void {
  for (let i = 0; i < list.length; i++) {
    if (list[i] === value) return; // duplicate
    if (list[i] > value) {
      list.splice(i, 0, value);
      return;
    }
  }
  list.push(value);
}
