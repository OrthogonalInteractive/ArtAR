import { localPoint, worldPoint } from './walls.js'

export const WALL_EXPANSION_LIMITS = Object.freeze({
  horizontal: 2,
  vertical: 1.5,
  knownBoundaryReach: 4,
  horizontalContactGap: 0.4,
})

const bounds = (points) => ({
  minX: Math.min(...points.map((p) => p.x)),
  maxX: Math.max(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxY: Math.max(...points.map((p) => p.y)),
})
const samePolygon = (a, b) =>
  a.length === b.length &&
  a.every(
    (p, i) => Math.abs(p.x - b[i].x) < 1e-6 && Math.abs(p.y - b[i].y) < 1e-6,
  )

/** Observed polygons stay untouched. Only this separate finite surface is used
 * for rendering and placement; it must never feed plane estimation. */
export function createWallExpansion() {
  const cache = new Map()
  return {
    update(walls, horizontalBoundaries = []) {
      const ids = new Set(walls.map((w) => w.id))
      for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id)
      return walls.map((wall) => {
        const observed = bounds(wall.polygon)
        const center = {
          x: (observed.minX + observed.maxX) / 2,
          y: (observed.minY + observed.maxY) / 2,
        }
        const centerWorld = worldPoint(wall, center)
        const reach = WALL_EXPANSION_LIMITS.knownBoundaryReach
        const sides = []
        for (const other of walls) {
          if (
            other.id === wall.id ||
            Math.abs(other.normal.dot(wall.normal)) > Math.cos(Math.PI / 9)
          )
            continue
          const ob = bounds(other.polygon)
          const otherCenter = worldPoint(other, {
            x: (ob.minX + ob.maxX) / 2,
            y: (ob.minY + ob.maxY) / 2,
          })
          // Both measured patches must face the same room interior. Disjoint
          // heights and corners beyond finite reach are not neighboring walls.
          if (
            other.plane.distanceToPoint(centerWorld) < 0 ||
            wall.plane.distanceToPoint(otherCenter) < 0
          )
            continue
          const overlapY =
            Math.min(ob.maxY + other.origin.y, observed.maxY + wall.origin.y) -
            Math.max(ob.minY + other.origin.y, observed.minY + wall.origin.y)
          if (overlapY < -0.3) continue
          const a = other.normal.dot(wall.right)
          const x = -other.plane.distanceToPoint(wall.origin) / a
          const otherX = localPoint(
            other,
            worldPoint(wall, { x, y: center.y }),
          ).x
          if (
            x < observed.minX - reach ||
            x > observed.maxX + reach ||
            otherX < ob.minX - reach ||
            otherX > ob.maxX + reach
          )
            continue
          sides.push({ wall: other, x, left: a > 0 })
        }
        const left = sides.filter((s) => s.left).sort((a, b) => b.x - a.x)[0]
        const right = sides.filter((s) => !s.left).sort((a, b) => a.x - b.x)[0]
        const minX = left?.x ?? observed.minX - WALL_EXPANSION_LIMITS.horizontal
        const maxX =
          right?.x ?? observed.maxX + WALL_EXPANSION_LIMITS.horizontal
        let floor, ceiling
        for (const boundary of horizontalBoundaries) {
          const y = boundary.origin.y - wall.origin.y
          if (y < observed.minY - reach || y > observed.maxY + reach) continue
          // A horizontal patch must actually approach this wall, not merely be
          // at a plausible height somewhere in the tracked room.
          const vertices = boundary.polygon.map((p) => ({
            x: p.x,
            y: boundary.origin.y,
            z: p.y,
          }))
          const distances = vertices.map((p) => wall.plane.distanceToPoint(p))
          const gap = WALL_EXPANSION_LIMITS.horizontalContactGap
          if (Math.min(...distances) > gap || Math.max(...distances) < -gap)
            continue
          const xs = vertices.map((p) => localPoint(wall, p).x)
          if (
            Math.max(...xs) < observed.minX - gap ||
            Math.min(...xs) > observed.maxX + gap
          )
            continue
          if (
            boundary.kind === 'ceiling' &&
            y >= observed.maxY - 0.1 &&
            (!ceiling || y < ceiling.y)
          )
            ceiling = { boundary, y }
          if (
            boundary.kind === 'floor' &&
            y <= observed.minY + 0.1 &&
            (!floor || y > floor.y)
          )
            floor = { boundary, y }
        }
        const minY = floor?.y ?? observed.minY - WALL_EXPANSION_LIMITS.vertical
        const maxY =
          ceiling?.y ?? observed.maxY + WALL_EXPANSION_LIMITS.vertical
        const surfacePolygon = [
          { x: minX, y: minY },
          { x: maxX, y: minY },
          { x: maxX, y: maxY },
          { x: minX, y: maxY },
        ]
        const boundaryWalls = [left?.wall, right?.wall].filter(Boolean)
        const boundaryIds = [
          ...boundaryWalls,
          floor?.boundary,
          ceiling?.boundary,
        ]
          .filter(Boolean)
          .map((b) => b.id)
        const old = cache.get(wall.id)
        if (
          old?.observed === wall &&
          samePolygon(old.surface.surfacePolygon, surfacePolygon) &&
          old.surface.boundaryIds.join() === boundaryIds.join()
        )
          return old.surface
        const surface = { ...wall, surfacePolygon, boundaryWalls, boundaryIds }
        cache.set(wall.id, { observed: wall, surface })
        return surface
      })
    },
    reset() {
      cache.clear()
    },
  }
}
