/**
 * Translated from ELK: HyperEdgeSegmentDependency.java
 * Copyright (c) 2010, 2020 Kiel University and others. EPL-2.0
 */
import type { HyperEdgeSegment } from './hyper-edge-segment.ts';

// Avoid const enum — fibjs crashes on them
export const DependencyType = {
  REGULAR: 0,
  CRITICAL: 1,
} as const;
export type DependencyType = (typeof DependencyType)[keyof typeof DependencyType];

export const CRITICAL_DEPENDENCY_WEIGHT = 1;

export class HyperEdgeSegmentDependency {
  readonly type: DependencyType;
  source: HyperEdgeSegment | null = null;
  target: HyperEdgeSegment | null = null;
  readonly weight: number;

  private constructor(type: DependencyType, source: HyperEdgeSegment, target: HyperEdgeSegment, weight: number) {
    this.type = type;
    this.weight = weight;
    this.setSource(source);
    this.setTarget(target);
  }

  static createAndAddRegular(source: HyperEdgeSegment, target: HyperEdgeSegment, weight: number): HyperEdgeSegmentDependency {
    return new HyperEdgeSegmentDependency(DependencyType.REGULAR, source, target, weight);
  }

  static createAndAddCritical(source: HyperEdgeSegment, target: HyperEdgeSegment): HyperEdgeSegmentDependency {
    return new HyperEdgeSegmentDependency(DependencyType.CRITICAL, source, target, CRITICAL_DEPENDENCY_WEIGHT);
  }

  remove(): void {
    this.setSource(null);
    this.setTarget(null);
  }

  reverse(): void {
    const oldSource = this.source;
    const oldTarget = this.target;
    this.setSource(oldTarget);
    this.setTarget(oldSource);
  }

  setSource(newSource: HyperEdgeSegment | null): void {
    if (this.source !== null) {
      const deps = this.source.outgoingSegmentDependencies;
      const idx = deps.indexOf(this);
      if (idx >= 0) deps.splice(idx, 1);
    }
    this.source = newSource;
    if (this.source !== null) {
      this.source.outgoingSegmentDependencies.push(this);
    }
  }

  setTarget(newTarget: HyperEdgeSegment | null): void {
    if (this.target !== null) {
      const deps = this.target.incomingSegmentDependencies;
      const idx = deps.indexOf(this);
      if (idx >= 0) deps.splice(idx, 1);
    }
    this.target = newTarget;
    if (this.target !== null) {
      this.target.incomingSegmentDependencies.push(this);
    }
  }
}
