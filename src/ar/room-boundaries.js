import { Vector3 } from 'three'
import {
  convexHull,
  clipPolygon,
  polygonArea,
  polygonGap,
  sampleWallPoints,
  surfaceSupport,
} from './walls.js'

export const BOUNDARY_LIMITS = Object.freeze({
  minPoints: 40,
  minSpan: 0.6,
  minArea: 0.5,
  heightTolerance: 0.025,
  stableHeight: 0.03,
  confirmations: 3,
})

// These are geometric room-boundary candidates, not semantic furniture labels.
// Height relative to the camera avoids treating ordinary desks as floor/ceiling.
export function horizontalKind(height, cameraPosition, semanticLabel = '') {
  if (semanticLabel && !['floor', 'ceiling'].includes(semanticLabel))
    return null
  if (height >= cameraPosition.y + 0.45 && semanticLabel !== 'floor')
    return 'ceiling'
  if (height <= cameraPosition.y - 0.9 && semanticLabel !== 'ceiling')
    return 'floor'
  return null
}

export function makeHorizontalBoundary({
  id,
  origin,
  polygon,
  kind,
  source = 'scan',
}) {
  const shape = convexHull(polygon)
  if (shape.length < 3 || !kind) return null
  const width =
    Math.max(...shape.map((p) => p.x)) - Math.min(...shape.map((p) => p.x))
  const depth =
    Math.max(...shape.map((p) => p.y)) - Math.min(...shape.map((p) => p.y))
  if (
    width < BOUNDARY_LIMITS.minSpan ||
    depth < BOUNDARY_LIMITS.minSpan ||
    polygonArea(shape) < BOUNDARY_LIMITS.minArea
  )
    return null
  return {
    id,
    origin: new Vector3().copy(origin),
    polygon: shape,
    kind,
    source,
  }
}

export function detectHorizontalBoundaries(rawPoints, cameraPosition) {
  let remaining = sampleWallPoints(rawPoints, cameraPosition)
    .filter((p) => horizontalKind(p.y, cameraPosition))
    .sort((a, b) => a.y - b.y)
  const required = Math.max(
    BOUNDARY_LIMITS.minPoints,
    Math.ceil(remaining.length * 0.12),
  )
  const candidates = []
  for (let pass = 0; pass < 3 && remaining.length >= required; pass++) {
    // Gravity fixes the normal. A sliding height window avoids choosing an
    // arbitrary sloping plane through unrelated ceiling/furniture points.
    let start = 0,
      bestStart = 0,
      bestEnd = 0
    for (let end = 0; end < remaining.length; end++) {
      while (
        remaining[end].y - remaining[start].y >
        BOUNDARY_LIMITS.heightTolerance * 2
      )
        start++
      if (end - start > bestEnd - bestStart) {
        bestStart = start
        bestEnd = end
      }
    }
    const points = remaining.slice(bestStart, bestEnd + 1)
    if (points.length < required) break
    const origin = points
      .reduce((sum, p) => sum.add(p), new Vector3())
      .multiplyScalar(1 / points.length)
    const projected = points.map((p) => ({ x: p.x, y: p.z }))
    const candidate = makeHorizontalBoundary({
      origin,
      polygon: projected,
      kind: horizontalKind(origin.y, cameraPosition),
    })
    if (candidate) {
      const width =
        Math.max(...projected.map((p) => p.x)) -
        Math.min(...projected.map((p) => p.x))
      const depth =
        Math.max(...projected.map((p) => p.y)) -
        Math.min(...projected.map((p) => p.y))
      const residual = Math.sqrt(
        points.reduce((sum, p) => sum + (p.y - origin.y) ** 2, 0) /
          points.length,
      )
      if (
        residual < 0.018 &&
        surfaceSupport(projected, candidate.polygon, width, depth).supported
      )
        candidates.push(candidate)
    }
    remaining.splice(bestStart, points.length)
  }
  return candidates
}

function overlaps(a, b) {
  let intersection = b.polygon
  for (let i = 0; i < a.polygon.length && intersection.length; i++) {
    const p = a.polygon[i],
      q = a.polygon[(i + 1) % a.polygon.length]
    const x = p.y - q.y,
      y = q.x - p.x
    intersection = clipPolygon(intersection, x, y, x * p.x + y * p.y)
  }
  return (
    polygonArea(intersection) > 1e-5 || polygonGap(a.polygon, b.polygon) < 0.3
  )
}
const native = (boundary) => boundary.source === 'webxr-plane'

/** Independent of wall counts. Confirmed height stays fixed until room reset. */
export function createBoundaryTracker() {
  let entries = [],
    counter = 0
  return {
    update(candidates, now, { cameraPosition } = {}) {
      entries = entries.filter((e) => e.confirmed || now - e.updated < 2500)
      const seen = new Set()
      for (const candidate of [...candidates].sort(
        (a, b) => Number(native(b)) - Number(native(a)),
      )) {
        let entry = entries
          .filter(
            (e) =>
              e.boundary.kind === candidate.kind &&
              Math.abs(e.boundary.origin.y - candidate.origin.y) <= 0.35 &&
              overlaps(e.boundary, candidate),
          )
          .sort((a, b) => Number(b.confirmed) - Number(a.confirmed))[0]
        if (
          entry &&
          (seen.has(entry) || (native(entry.boundary) && !native(candidate)))
        )
          continue
        if (!entry) {
          entry = {
            boundary: { ...candidate, id: `boundary-${++counter}` },
            count: 0,
            confirmed: false,
            updated: now,
          }
          entries.push(entry)
        }
        const difference = Math.abs(
          entry.boundary.origin.y - candidate.origin.y,
        )
        if (entry.confirmed && difference > BOUNDARY_LIMITS.stableHeight)
          continue
        if (
          !entry.count ||
          difference > BOUNDARY_LIMITS.stableHeight ||
          (!entry.confirmed && native(candidate) && !native(entry.boundary))
        ) {
          entry.boundary = { ...candidate, id: entry.boundary.id }
          entry.count = 0
          entry.firstCamera = cameraPosition?.clone()
          entry.shift = 0
        }
        if (entry.firstCamera && cameraPosition)
          entry.shift = Math.max(
            entry.shift,
            entry.firstCamera.distanceTo(cameraPosition),
          )
        entry.count = Math.min(entry.count + 1, BOUNDARY_LIMITS.confirmations)
        entry.confirmed ||=
          entry.count >= BOUNDARY_LIMITS.confirmations &&
          (candidate.source !== 'scan' ||
            !entry.firstCamera ||
            entry.shift >= 0.06)
        const polygon = convexHull([
          ...entry.boundary.polygon,
          ...candidate.polygon,
        ])
        // Preserve object identity when there is no new measured area.
        if (
          polygon.length !== entry.boundary.polygon.length ||
          polygon.some(
            (p, i) =>
              p.x !== entry.boundary.polygon[i].x ||
              p.y !== entry.boundary.polygon[i].y,
          )
        )
          entry.boundary = { ...entry.boundary, polygon }
        entry.updated = now
        seen.add(entry)
      }
      for (const entry of entries)
        if (!entry.confirmed && !seen.has(entry)) entry.count = 0
      return entries.filter((e) => e.confirmed).map((e) => e.boundary)
    },
    reset() {
      entries = []
      counter = 0
    },
  }
}
