/**
 * Translated from ELK: HyperEdgeCycleDetector.java
 * Copyright (c) 2010, 2020 Kiel University and others. EPL-2.0
 *
 * Finds a set of dependencies to remove or reverse to break cycles.
 * Uses Eades-Lin-Smyth heuristic for feedback arc set.
 */
import { HyperEdgeSegment } from './hyper-edge-segment.ts';
import { HyperEdgeSegmentDependency, DependencyType } from './hyper-edge-segment-dependency.ts';

export function detectCycles(
  segments: HyperEdgeSegment[],
  criticalOnly: boolean,
): HyperEdgeSegmentDependency[] {
  const result: HyperEdgeSegmentDependency[] = [];

  const sources: HyperEdgeSegment[] = [];
  const sinks: HyperEdgeSegment[] = [];

  // initialize values for the algorithm
  initialize(segments, sources, sinks, criticalOnly);

  // assign marks to all nodes
  computeLinearOrderingMarks(segments, sources, sinks, criticalOnly);

  // process edges that point left: collect those for removal or reversal
  for (const source of segments) {
    // iterate over a copy because deps may be mutated later
    for (const outDependency of source.outgoingSegmentDependencies) {
      if (!criticalOnly || outDependency.type === DependencyType.CRITICAL) {
        if (source.mark > outDependency.target!.mark) {
          result.push(outDependency);
        }
      }
    }
  }

  return result;
}

function initialize(
  segments: HyperEdgeSegment[],
  sources: HyperEdgeSegment[],
  sinks: HyperEdgeSegment[],
  criticalOnly: boolean,
): void {
  let nextMark = -1;
  for (const segment of segments) {
    segment.mark = nextMark--;

    // Sum up critical dependency weights
    let criticalInWeight = 0;
    let criticalOutWeight = 0;
    for (const dep of segment.incomingSegmentDependencies) {
      if (dep.type === DependencyType.CRITICAL) criticalInWeight += dep.weight;
    }
    for (const dep of segment.outgoingSegmentDependencies) {
      if (dep.type === DependencyType.CRITICAL) criticalOutWeight += dep.weight;
    }

    let inWeight = criticalInWeight;
    let outWeight = criticalOutWeight;

    if (!criticalOnly) {
      inWeight = 0;
      outWeight = 0;
      for (const dep of segment.incomingSegmentDependencies) inWeight += dep.weight;
      for (const dep of segment.outgoingSegmentDependencies) outWeight += dep.weight;
    }

    segment.inDepWeight = inWeight;
    segment.criticalInDepWeight = criticalInWeight;
    segment.outDepWeight = outWeight;
    segment.criticalOutDepWeight = criticalOutWeight;

    if (outWeight === 0) {
      sinks.push(segment);
    } else if (inWeight === 0) {
      sources.push(segment);
    }
  }
}

function computeLinearOrderingMarks(
  segments: HyperEdgeSegment[],
  sources: HyperEdgeSegment[],
  sinks: HyperEdgeSegment[],
  criticalOnly: boolean,
): void {
  const unprocessed = new Set<HyperEdgeSegment>(segments);
  const maxSegments: HyperEdgeSegment[] = [];

  const markBase = segments.length;
  let nextSinkMark = markBase - 1;
  let nextSourceMark = markBase + 1;

  while (unprocessed.size > 0) {
    while (sinks.length > 0) {
      const sink = sinks.shift()!;
      unprocessed.delete(sink);
      sink.mark = nextSinkMark--;
      updateNeighbors(sink, sources, sinks, criticalOnly);
    }

    while (sources.length > 0) {
      const source = sources.shift()!;
      unprocessed.delete(source);
      source.mark = nextSourceMark++;
      updateNeighbors(source, sources, sinks, criticalOnly);
    }

    // Find segments with highest out flow to place among sources
    let maxOutflow = -Infinity;
    for (const segment of Array.from(unprocessed)) {
      // Ensure critical deps always point rightward
      if (!criticalOnly && segment.criticalOutDepWeight > 0 && segment.criticalInDepWeight <= 0) {
        maxSegments.length = 0;
        maxSegments.push(segment);
        break;
      }

      const outflow = segment.outDepWeight - segment.inDepWeight;
      if (outflow >= maxOutflow) {
        if (outflow > maxOutflow) {
          maxSegments.length = 0;
          maxOutflow = outflow;
        }
        maxSegments.push(segment);
      }
    }

    if (maxSegments.length > 0) {
      const maxNode = maxSegments[Math.floor(Math.random() * maxSegments.length)];
      unprocessed.delete(maxNode);
      maxNode.mark = nextSourceMark++;
      updateNeighbors(maxNode, sources, sinks, criticalOnly);
      maxSegments.length = 0;
    }
  }

  // Shift sink marks so they are higher than source marks
  const shiftBase = segments.length + 1;
  for (const node of segments) {
    if (node.mark < markBase) {
      node.mark = node.mark + shiftBase;
    }
  }
}

function updateNeighbors(
  node: HyperEdgeSegment,
  sources: HyperEdgeSegment[],
  sinks: HyperEdgeSegment[],
  criticalOnly: boolean,
): void {
  // process following nodes
  for (const dep of node.outgoingSegmentDependencies) {
    if (!criticalOnly || dep.type === DependencyType.CRITICAL) {
      const target = dep.target!;
      if (target.mark < 0 && dep.weight > 0) {
        target.inDepWeight -= dep.weight;
        if (dep.type === DependencyType.CRITICAL) {
          target.criticalInDepWeight -= dep.weight;
        }
        if (target.inDepWeight <= 0 && target.outDepWeight > 0) {
          sources.push(target);
        }
      }
    }
  }

  // process preceding nodes
  for (const dep of node.incomingSegmentDependencies) {
    if (!criticalOnly || dep.type === DependencyType.CRITICAL) {
      const source = dep.source!;
      if (source.mark < 0 && dep.weight > 0) {
        source.outDepWeight -= dep.weight;
        if (dep.type === DependencyType.CRITICAL) {
          source.criticalOutDepWeight -= dep.weight;
        }
        if (source.outDepWeight <= 0 && source.inDepWeight > 0) {
          sinks.push(source);
        }
      }
    }
  }
}
