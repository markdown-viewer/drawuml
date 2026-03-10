/**
 * Translated from ELK: OrthogonalRoutingGenerator.java
 * Copyright (c) 2010, 2020 Kiel University and others. EPL-2.0
 *
 * Core orthogonal edge routing algorithm. Creates dependencies between
 * HyperEdgeSegments, breaks cycles, assigns routing slots via topological
 * numbering. Adapted from ELK's layer-pair routing to work with externally
 * created segments.
 */
import { HyperEdgeSegment } from './hyper-edge-segment.ts';
import { HyperEdgeSegmentDependency } from './hyper-edge-segment-dependency.ts';
import { detectCycles } from './hyper-edge-cycle-detector.ts';
import { splitSegments } from './hyper-edge-segment-splitter.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOLERANCE = 1e-3;
const CRITICAL_CONFLICTS_DETECTED = -1;
const CONFLICT_THRESHOLD_FACTOR = 0.5;
const CRITICAL_CONFLICT_THRESHOLD_FACTOR = 0.2;
const CONFLICT_PENALTY = 1;
const CROSSING_PENALTY = 16;

// ---------------------------------------------------------------------------
// Main entry: route edge segments between a pair of layers
// ---------------------------------------------------------------------------

/**
 * Route edges between two layers. Segments must already be created with their
 * incoming/outgoing connection coordinates set.
 *
 * After this call, each segment's routingSlot is assigned.
 *
 * @returns the number of routing slots used
 */
export function routeEdgesBetweenLayers(
  edgeSegments: HyperEdgeSegment[],
  edgeSpacing: number,
): number {
  if (edgeSegments.length === 0) return 0;

  const conflictThreshold = CONFLICT_THRESHOLD_FACTOR * edgeSpacing;
  let criticalConflictThreshold = CRITICAL_CONFLICT_THRESHOLD_FACTOR * minimumHorizontalSegmentDistance(edgeSegments);

  // Build dependency graph
  let criticalDependencyCount = 0;
  const createDep = (he1: HyperEdgeSegment, he2: HyperEdgeSegment) =>
    createDependencyIfNecessary(he1, he2, conflictThreshold, criticalConflictThreshold);

  for (let i = 0; i < edgeSegments.length - 1; i++) {
    for (let j = i + 1; j < edgeSegments.length; j++) {
      criticalDependencyCount += createDep(edgeSegments[i], edgeSegments[j]);
    }
  }

  // Break critical cycles (may split segments, adding new ones to edgeSegments)
  if (criticalDependencyCount >= 2) {
    const cycleDeps = detectCycles(edgeSegments, true);
    splitSegments(cycleDeps, edgeSegments, criticalConflictThreshold, createDep);
  }

  // Break non-critical cycles
  breakNonCriticalCycles(edgeSegments);

  // Topological numbering
  topologicalNumbering(edgeSegments);

  // Find max routing slot
  let rankCount = -1;
  for (const seg of edgeSegments) {
    if (Math.abs(seg.startPosition - seg.endPosition) < TOLERANCE) continue;
    rankCount = Math.max(rankCount, seg.routingSlot);
  }

  return rankCount + 1;
}

// ---------------------------------------------------------------------------
// Dependency creation
// ---------------------------------------------------------------------------

export function createDependencyIfNecessary(
  he1: HyperEdgeSegment,
  he2: HyperEdgeSegment,
  conflictThreshold: number,
  criticalConflictThreshold: number,
): number {
  // Straight lines don't create dependencies
  if (Math.abs(he1.startPosition - he1.endPosition) < TOLERANCE
    || Math.abs(he2.startPosition - he2.endPosition) < TOLERANCE) {
    return 0;
  }

  const conflicts1 = countConflicts(he1.outgoingConnectionCoordinates, he2.incomingConnectionCoordinates,
    conflictThreshold, criticalConflictThreshold);
  const conflicts2 = countConflicts(he2.outgoingConnectionCoordinates, he1.incomingConnectionCoordinates,
    conflictThreshold, criticalConflictThreshold);

  const criticalConflictsDetected =
    conflicts1 === CRITICAL_CONFLICTS_DETECTED || conflicts2 === CRITICAL_CONFLICTS_DETECTED;
  let criticalDependencyCount = 0;

  if (criticalConflictsDetected) {
    if (conflicts1 === CRITICAL_CONFLICTS_DETECTED) {
      HyperEdgeSegmentDependency.createAndAddCritical(he2, he1);
      criticalDependencyCount++;
    }
    if (conflicts2 === CRITICAL_CONFLICTS_DETECTED) {
      HyperEdgeSegmentDependency.createAndAddCritical(he1, he2);
      criticalDependencyCount++;
    }
  } else {
    let crossings1 = countCrossings(he1.outgoingConnectionCoordinates, he2.startPosition, he2.endPosition);
    crossings1 += countCrossings(he2.incomingConnectionCoordinates, he1.startPosition, he1.endPosition);
    let crossings2 = countCrossings(he2.outgoingConnectionCoordinates, he1.startPosition, he1.endPosition);
    crossings2 += countCrossings(he1.incomingConnectionCoordinates, he2.startPosition, he2.endPosition);

    const depValue1 = CONFLICT_PENALTY * conflicts1 + CROSSING_PENALTY * crossings1;
    const depValue2 = CONFLICT_PENALTY * conflicts2 + CROSSING_PENALTY * crossings2;

    if (depValue1 < depValue2) {
      HyperEdgeSegmentDependency.createAndAddRegular(he1, he2, depValue2 - depValue1);
    } else if (depValue1 > depValue2) {
      HyperEdgeSegmentDependency.createAndAddRegular(he2, he1, depValue1 - depValue2);
    } else if (depValue1 > 0 && depValue2 > 0) {
      HyperEdgeSegmentDependency.createAndAddRegular(he1, he2, 0);
      HyperEdgeSegmentDependency.createAndAddRegular(he2, he1, 0);
    }
  }

  return criticalDependencyCount;
}

// ---------------------------------------------------------------------------
// Conflict & crossing counting
// ---------------------------------------------------------------------------

function countConflicts(
  posis1: number[],
  posis2: number[],
  conflictThreshold: number,
  criticalConflictThreshold: number,
): number {
  let conflicts = 0;

  if (posis1.length > 0 && posis2.length > 0) {
    let i1 = 0, i2 = 0;
    let pos1 = posis1[0], pos2 = posis2[0];
    let hasMore = true;

    do {
      if (pos1 > pos2 - criticalConflictThreshold && pos1 < pos2 + criticalConflictThreshold) {
        return CRITICAL_CONFLICTS_DETECTED;
      } else if (pos1 > pos2 - conflictThreshold && pos1 < pos2 + conflictThreshold) {
        conflicts++;
      }

      if (pos1 <= pos2 && i1 + 1 < posis1.length) {
        pos1 = posis1[++i1];
      } else if (pos2 <= pos1 && i2 + 1 < posis2.length) {
        pos2 = posis2[++i2];
      } else {
        hasMore = false;
      }
    } while (hasMore);
  }

  return conflicts;
}

export function countCrossings(posis: number[], start: number, end: number): number {
  let crossings = 0;
  for (const pos of posis) {
    if (pos > end) break;
    else if (pos >= start) crossings++;
  }
  return crossings;
}

// ---------------------------------------------------------------------------
// Cycle breaking (non-critical)
// ---------------------------------------------------------------------------

export function breakNonCriticalCycles(edgeSegments: HyperEdgeSegment[]): void {
  const cycleDeps = detectCycles(edgeSegments, false);
  for (const dep of cycleDeps) {
    if (dep.weight === 0) {
      dep.remove();
    } else {
      dep.reverse();
    }
  }
}

// ---------------------------------------------------------------------------
// Topological numbering
// ---------------------------------------------------------------------------

export function topologicalNumbering(segments: HyperEdgeSegment[]): void {
  const sources: HyperEdgeSegment[] = [];
  const rightwardTargets: HyperEdgeSegment[] = [];

  for (const node of segments) {
    node.inDepWeight = node.incomingSegmentDependencies.length;
    node.outDepWeight = node.outgoingSegmentDependencies.length;

    if (node.inDepWeight === 0) {
      sources.push(node);
    }
    if (node.outDepWeight === 0 && node.incomingConnectionCoordinates.length === 0) {
      rightwardTargets.push(node);
    }
  }

  let maxRank = -1;

  // Forward pass — assign ranks via topological order
  while (sources.length > 0) {
    const node = sources.shift()!;
    for (const dep of node.outgoingSegmentDependencies) {
      const target = dep.target!;
      target.routingSlot = Math.max(target.routingSlot, node.routingSlot + 1);
      maxRank = Math.max(maxRank, target.routingSlot);

      target.inDepWeight--;
      if (target.inDepWeight === 0) {
        sources.push(target);
      }
    }
  }

  // Rightward-target optimization: move segments with only outgoing coords as far right as possible
  if (maxRank > -1) {
    for (const node of rightwardTargets) {
      node.routingSlot = maxRank;
    }

    while (rightwardTargets.length > 0) {
      const node = rightwardTargets.shift()!;
      for (const dep of node.incomingSegmentDependencies) {
        const source = dep.source!;
        if (source.incomingConnectionCoordinates.length > 0) continue;

        source.routingSlot = Math.min(source.routingSlot, node.routingSlot - 1);

        source.outDepWeight--;
        if (source.outDepWeight === 0) {
          rightwardTargets.push(source);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: minimum horizontal segment distance
// ---------------------------------------------------------------------------

function minimumHorizontalSegmentDistance(edgeSegments: HyperEdgeSegment[]): number {
  const inCoords: number[] = [];
  const outCoords: number[] = [];
  for (const seg of edgeSegments) {
    for (const c of seg.incomingConnectionCoordinates) inCoords.push(c);
    for (const c of seg.outgoingConnectionCoordinates) outCoords.push(c);
  }
  return Math.min(minimumDifference(inCoords), minimumDifference(outCoords));
}

function minimumDifference(numbers: number[]): number {
  if (numbers.length < 2) return Number.MAX_VALUE;

  // Sort and deduplicate
  numbers.sort((a, b) => a - b);
  let minDiff = Number.MAX_VALUE;
  let prev = numbers[0];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== prev) {
      minDiff = Math.min(minDiff, numbers[i] - prev);
      prev = numbers[i];
    }
  }
  return minDiff;
}
