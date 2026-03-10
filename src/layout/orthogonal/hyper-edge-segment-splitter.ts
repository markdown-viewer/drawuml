/**
 * Translated from ELK: HyperEdgeSegmentSplitter.java
 * Copyright (c) 2020 Kiel University and others. EPL-2.0
 *
 * Splits HyperEdgeSegments to avoid overlaps caused by critical dependency cycles.
 */
import { HyperEdgeSegment } from './hyper-edge-segment.ts';
import { HyperEdgeSegmentDependency } from './hyper-edge-segment-dependency.ts';
import { countCrossings } from './orthogonal-routing-generator.ts';

interface FreeArea {
  startPosition: number;
  endPosition: number;
  size: number;
}

interface AreaRating {
  dependencies: number;
  crossings: number;
}

function newFreeArea(start: number, end: number): FreeArea {
  return { startPosition: start, endPosition: end, size: end - start };
}

function centerOfSegment(s: HyperEdgeSegment): number {
  return (s.startPosition + s.endPosition) / 2;
}

function centerOfArea(a: FreeArea): number {
  return (a.startPosition + a.endPosition) / 2;
}

export function splitSegments(
  dependenciesToResolve: HyperEdgeSegmentDependency[],
  segments: HyperEdgeSegment[],
  criticalConflictThreshold: number,
  createDependencyIfNecessary: (he1: HyperEdgeSegment, he2: HyperEdgeSegment) => number,
): void {
  if (dependenciesToResolve.length === 0) return;

  // Collect free areas between horizontal segments
  const freeAreas = findFreeAreas(segments, criticalConflictThreshold);

  // Choose which segments to split
  const segmentsToSplit = decideWhichSegmentsToSplit(dependenciesToResolve);

  // Split from smallest to largest
  const sorted = Array.from(segmentsToSplit).sort((a, b) => a.getLength() - b.getLength());
  for (const segment of sorted) {
    split(segment, segments, freeAreas, criticalConflictThreshold, createDependencyIfNecessary);
  }
}

function findFreeAreas(segments: HyperEdgeSegment[], criticalConflictThreshold: number): FreeArea[] {
  const freeAreas: FreeArea[] = [];

  // Collect all port coordinates and sort
  const coords: number[] = [];
  for (const s of segments) {
    for (const c of s.incomingConnectionCoordinates) coords.push(c);
    for (const c of s.outgoingConnectionCoordinates) coords.push(c);
  }
  coords.sort((a, b) => a - b);

  // Create free areas for gaps >= 2 * criticalConflictThreshold
  for (let i = 1; i < coords.length; i++) {
    if (coords[i] - coords[i - 1] >= 2 * criticalConflictThreshold) {
      freeAreas.push(newFreeArea(
        coords[i - 1] + criticalConflictThreshold,
        coords[i] - criticalConflictThreshold,
      ));
    }
  }

  return freeAreas;
}

function decideWhichSegmentsToSplit(
  dependencies: HyperEdgeSegmentDependency[],
): Set<HyperEdgeSegment> {
  const segmentsToSplit = new Set<HyperEdgeSegment>();

  for (const dependency of dependencies) {
    const sourceSegment = dependency.source!;
    const targetSegment = dependency.target!;

    if (segmentsToSplit.has(sourceSegment) || segmentsToSplit.has(targetSegment)) {
      continue;
    }

    let segmentToSplit = sourceSegment;
    let segmentCausingSplit = targetSegment;

    // Prefer splitting non-hyperedges
    if (sourceSegment.representsHyperedge() && !targetSegment.representsHyperedge()) {
      segmentToSplit = targetSegment;
      segmentCausingSplit = sourceSegment;
    }

    segmentsToSplit.add(segmentToSplit);
    segmentToSplit.splitBy = segmentCausingSplit;
  }

  return segmentsToSplit;
}

function split(
  segment: HyperEdgeSegment,
  segments: HyperEdgeSegment[],
  freeAreas: FreeArea[],
  criticalConflictThreshold: number,
  createDependencyIfNecessary: (he1: HyperEdgeSegment, he2: HyperEdgeSegment) => number,
): void {
  const splitPosition = computePositionToSplitAndUpdateFreeAreas(segment, freeAreas, criticalConflictThreshold);
  segments.push(segment.splitAt(splitPosition));
  updateDependencies(segment, segments, createDependencyIfNecessary);
}

function updateDependencies(
  segment: HyperEdgeSegment,
  segments: HyperEdgeSegment[],
  createDependencyIfNecessary: (he1: HyperEdgeSegment, he2: HyperEdgeSegment) => number,
): void {
  const splitCausingSegment = segment.splitBy!;
  const splitPartner = segment.splitPartner!;

  // segment ---> split-causing segment ---> split partner
  HyperEdgeSegmentDependency.createAndAddCritical(segment, splitCausingSegment);
  HyperEdgeSegmentDependency.createAndAddCritical(splitCausingSegment, splitPartner);

  // Re-introduce dependencies to other segments
  for (const otherSegment of segments) {
    if (otherSegment !== splitCausingSegment && otherSegment !== segment && otherSegment !== splitPartner) {
      createDependencyIfNecessary(otherSegment, segment);
      createDependencyIfNecessary(otherSegment, splitPartner);
    }
  }
}

function computePositionToSplitAndUpdateFreeAreas(
  segment: HyperEdgeSegment,
  freeAreas: FreeArea[],
  criticalConflictThreshold: number,
): number {
  let firstPossibleAreaIndex = -1;
  let lastPossibleAreaIndex = -1;

  for (let i = 0; i < freeAreas.length; i++) {
    const currArea = freeAreas[i];
    if (currArea.startPosition > segment.endPosition) {
      break;
    } else if (currArea.endPosition >= segment.startPosition) {
      if (firstPossibleAreaIndex < 0) {
        firstPossibleAreaIndex = i;
      }
      lastPossibleAreaIndex = i;
    }
  }

  let splitPosition = centerOfSegment(segment);

  if (firstPossibleAreaIndex >= 0) {
    const bestAreaIndex = chooseBestAreaIndex(segment, freeAreas, firstPossibleAreaIndex, lastPossibleAreaIndex);
    splitPosition = centerOfArea(freeAreas[bestAreaIndex]);
    useArea(freeAreas, bestAreaIndex, criticalConflictThreshold);
  }

  return splitPosition;
}

function chooseBestAreaIndex(
  segment: HyperEdgeSegment,
  freeAreas: FreeArea[],
  fromIndex: number,
  toIndex: number,
): number {
  let bestAreaIndex = fromIndex;

  if (fromIndex < toIndex) {
    const [splitSegment, splitPartner] = segment.simulateSplit();

    let bestArea = freeAreas[bestAreaIndex];
    let bestRating = rateArea(segment, splitSegment, splitPartner, bestArea);

    for (let i = fromIndex + 1; i <= toIndex; i++) {
      const currArea = freeAreas[i];
      const currRating = rateArea(segment, splitSegment, splitPartner, currArea);

      if (isBetter(currArea, currRating, bestArea, bestRating)) {
        bestArea = currArea;
        bestRating = currRating;
        bestAreaIndex = i;
      }
    }
  }

  return bestAreaIndex;
}

function rateArea(
  segment: HyperEdgeSegment,
  splitSegment: HyperEdgeSegment,
  splitPartner: HyperEdgeSegment,
  area: FreeArea,
): AreaRating {
  const areaCentre = centerOfArea(area);

  splitSegment.outgoingConnectionCoordinates.length = 0;
  splitSegment.outgoingConnectionCoordinates.push(areaCentre);

  splitPartner.incomingConnectionCoordinates.length = 0;
  splitPartner.incomingConnectionCoordinates.push(areaCentre);

  const rating: AreaRating = { dependencies: 0, crossings: 0 };

  for (const dependency of segment.incomingSegmentDependencies) {
    const otherSegment = dependency.source!;
    updateConsideringBothOrderings(rating, splitSegment, otherSegment);
    updateConsideringBothOrderings(rating, splitPartner, otherSegment);
  }

  for (const dependency of segment.outgoingSegmentDependencies) {
    const otherSegment = dependency.target!;
    updateConsideringBothOrderings(rating, splitSegment, otherSegment);
    updateConsideringBothOrderings(rating, splitPartner, otherSegment);
  }

  // Two additional deps: splitSegment --> splitBy --> splitPartner
  rating.dependencies += 2;
  rating.crossings += countCrossingsForSingleOrdering(splitSegment, segment.splitBy!);
  rating.crossings += countCrossingsForSingleOrdering(segment.splitBy!, splitPartner);

  return rating;
}

function updateConsideringBothOrderings(
  rating: AreaRating,
  s1: HyperEdgeSegment,
  s2: HyperEdgeSegment,
): void {
  const crossingsS1Left = countCrossingsForSingleOrdering(s1, s2);
  const crossingsS2Left = countCrossingsForSingleOrdering(s2, s1);

  if (crossingsS1Left === crossingsS2Left) {
    if (crossingsS1Left > 0) {
      rating.dependencies += 2;
      rating.crossings += crossingsS1Left;
    }
  } else {
    rating.dependencies += 1;
    rating.crossings += Math.min(crossingsS1Left, crossingsS2Left);
  }
}

function countCrossingsForSingleOrdering(left: HyperEdgeSegment, right: HyperEdgeSegment): number {
  return countCrossings(left.outgoingConnectionCoordinates, right.startPosition, right.endPosition)
    + countCrossings(right.incomingConnectionCoordinates, left.startPosition, left.endPosition);
}

function isBetter(currArea: FreeArea, currRating: AreaRating, bestArea: FreeArea, bestRating: AreaRating): boolean {
  if (currRating.crossings < bestRating.crossings) {
    return true;
  } else if (currRating.crossings === bestRating.crossings) {
    if (currRating.dependencies < bestRating.dependencies) {
      return true;
    } else if (currRating.dependencies === bestRating.dependencies) {
      if (currArea.size > bestArea.size) {
        return true;
      }
    }
  }
  return false;
}

function useArea(freeAreas: FreeArea[], usedAreaIndex: number, criticalConflictThreshold: number): void {
  const oldArea = freeAreas[usedAreaIndex];
  freeAreas.splice(usedAreaIndex, 1);

  if (oldArea.size / 2 >= criticalConflictThreshold) {
    let insertIndex = usedAreaIndex;
    const oldAreaCentre = centerOfArea(oldArea);

    const newEnd1 = oldAreaCentre - criticalConflictThreshold;
    if (oldArea.startPosition <= newEnd1) {
      freeAreas.splice(insertIndex++, 0, newFreeArea(oldArea.startPosition, newEnd1));
    }

    const newStart2 = oldAreaCentre + criticalConflictThreshold;
    if (newStart2 <= oldArea.endPosition) {
      freeAreas.splice(insertIndex, 0, newFreeArea(newStart2, oldArea.endPosition));
    }
  }
}
