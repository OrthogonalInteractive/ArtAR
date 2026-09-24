import { Vector3, Matrix4, Quaternion, Plane } from 'three'

const UP = new Vector3(0, 1, 0)
const EPS = 1e-7
const cross2 = (a, b, c) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)

export function convexHull(points) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return []
  const lower = [],
    upper = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross2(lower.at(-2), lower.at(-1), p) <= EPS)
      lower.pop()
    lower.push(p)
  }
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross2(upper.at(-2), upper.at(-1), p) <= EPS)
      upper.pop()
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export function makeWall({ id, origin, normal, polygon, source = 'scan' }) {
  const n = new Vector3(normal.x, 0, normal.z).normalize()
  if (n.lengthSq() < 0.99) throw new Error('垂直面の法線が必要です')
  const right = new Vector3().crossVectors(UP, n).normalize()
  const o = new Vector3().copy(origin)
  return {
    id,
    origin: o,
    normal: n,
    right,
    up: UP.clone(),
    polygon: convexHull(polygon),
    source,
    rotation: new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(right, UP, n),
    ),
    plane: new Plane().setFromNormalAndCoplanarPoint(n, o),
  }
}
export const localPoint = (wall, point) => {
  const d = new Vector3().subVectors(point, wall.origin)
  return { x: d.dot(wall.right), y: d.dot(wall.up) }
}
export const worldPoint = (wall, point, depth = 0) =>
  wall.origin
    .clone()
    .addScaledVector(wall.right, point.x)
    .addScaledVector(wall.up, point.y)
    .addScaledVector(wall.normal, depth)

function clip(polygon, a, b, c) {
  const result = []
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i],
      q = polygon[(i + 1) % polygon.length]
    const dp = a * p.x + b * p.y - c,
      dq = a * q.x + b * q.y - c
    if (dp >= -EPS) result.push(p)
    if (dp >= 0 !== dq >= 0) {
      const t = dp / (dp - dq)
      result.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
    }
  }
  return result
}

// These are association tolerances, not a claim about measurement accuracy.
export const WALL_MATCH_LIMITS = Object.freeze({
  sameNormal: 0.985,
  sameDepth: 0.1,
  adjacentGap: 0.25,
  duplicateNormal: Math.cos(Math.PI / 12),
  duplicateDepth: 0.35,
  duplicateOverlap: 0.55,
})
const polygonArea = (polygon) =>
  Math.abs(
    polygon.reduce((sum, p, i) => {
      const q = polygon[(i + 1) % polygon.length]
      return sum + p.x * q.y - q.x * p.y
    }, 0),
  ) / 2

function polygonGap(a, b) {
  let closest = Infinity
  for (const [points, edges] of [
    [a, b],
    [b, a],
  ])
    for (const p of points)
      for (let i = 0; i < edges.length; i++) {
        const q = edges[i],
          r = edges[(i + 1) % edges.length]
        const dx = r.x - q.x,
          dy = r.y - q.y
        const t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - q.x) * dx + (p.y - q.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        )
        closest = Math.min(
          closest,
          Math.hypot(p.x - q.x - t * dx, p.y - q.y - t * dy),
        )
      }
  return closest
}

/** Compare actual footprints, not just their (view-dependent) centroids.
 * 'same' may extend a footprint. 'duplicate' is an ambiguous nearby layer:
 * suppress it without moving, expanding or reconfirming the existing wall.
 */
export function wallMatch(first, second) {
  const a = first.plane ? first : makeWall(first)
  const b = second.plane ? second : makeWall(second)
  const dot = a.normal.dot(b.normal)
  if (
    dot < WALL_MATCH_LIMITS.duplicateNormal ||
    a.polygon.length < 3 ||
    b.polygon.length < 3
  )
    return null
  const projected = convexHull(
    b.polygon.map((p) => localPoint(a, worldPoint(b, p))),
  )
  let overlap = projected
  for (let i = 0; i < a.polygon.length && overlap.length; i++) {
    const p = a.polygon[i],
      q = a.polygon[(i + 1) % a.polygon.length]
    const x = p.y - q.y,
      y = q.x - p.x
    overlap = clip(overlap, x, y, x * p.x + y * p.y)
  }
  const area = polygonArea(overlap)
  const centerPoints = area > EPS ? overlap : projected
  const center = centerPoints.reduce(
    (sum, p) => ({
      x: sum.x + p.x / centerPoints.length,
      y: sum.y + p.y / centerPoints.length,
    }),
    { x: 0, y: 0 },
  )
  const distance =
    Math.abs(b.plane.distanceToPoint(worldPoint(a, center))) / dot
  if (
    dot > WALL_MATCH_LIMITS.sameNormal &&
    distance < WALL_MATCH_LIMITS.sameDepth &&
    (area > EPS ||
      polygonGap(a.polygon, projected) <= WALL_MATCH_LIMITS.adjacentGap)
  )
    return 'same'
  const smallerArea = Math.min(polygonArea(a.polygon), polygonArea(projected))
  if (
    smallerArea > EPS &&
    area / smallerArea >= WALL_MATCH_LIMITS.duplicateOverlap &&
    distance <= WALL_MATCH_LIMITS.duplicateDepth
  )
    return 'duplicate'
  return null
}

// Native planes take precedence over a depth/hit estimate of the same surface.
const observationPriority = (wall) => (wall.source === 'webxr-plane' ? 2 : 1)

/** Erode a convex wall by the complete framed rectangle, then clip room corners. */
export function placementArea(
  wall,
  width,
  height,
  neighbors = [],
  depth = 0.04,
  margin = 0.02,
) {
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) return []
  let area = wall.polygon.map((p) => ({ ...p }))
  const hx = width / 2 + margin,
    hy = height / 2 + margin
  for (let i = 0; i < wall.polygon.length && area.length; i++) {
    const p = wall.polygon[i],
      q = wall.polygon[(i + 1) % wall.polygon.length]
    const a = p.y - q.y,
      b = q.x - p.x
    area = clip(
      area,
      a,
      b,
      a * p.x + b * p.y + Math.abs(a) * hx + Math.abs(b) * hy,
    )
  }
  for (const other of neighbors) {
    if (other.id === wall.id || Math.abs(other.normal.dot(wall.normal)) > 0.98)
      continue
    // Consider only neighboring scanned patches near this wall, not arbitrary planes across the room.
    if (other.origin.distanceTo(wall.origin) > 6) continue
    const a = other.normal.dot(wall.right),
      b = other.normal.dot(wall.up)
    const signedOrigin = other.plane.distanceToPoint(wall.origin)
    const extrusion = Math.min(0, other.normal.dot(wall.normal) * depth)
    area = clip(
      area,
      a,
      b,
      margin +
        (Math.abs(a) * width) / 2 +
        (Math.abs(b) * height) / 2 -
        signedOrigin -
        extrusion,
    )
  }
  return area
}

export function fitPlacement(
  wall,
  requested,
  width,
  height,
  neighbors = [],
  depth = 0.04,
  margin = 0.02,
) {
  const area = placementArea(wall, width, height, neighbors, depth, margin)
  if (area.length < 3) return null
  const inside = area.every(
    (a, i) => cross2(a, area[(i + 1) % area.length], requested) >= -EPS,
  )
  if (inside) return { ...requested, clamped: false }
  let best,
    distance = Infinity
  for (let i = 0; i < area.length; i++) {
    const a = area[i],
      b = area[(i + 1) % area.length]
    const dx = b.x - a.x,
      dy = b.y - a.y
    const t = Math.max(
      0,
      Math.min(
        1,
        ((requested.x - a.x) * dx + (requested.y - a.y) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    )
    const p = { x: a.x + t * dx, y: a.y + t * dy }
    const d = (requested.x - p.x) ** 2 + (requested.y - p.y) ** 2
    if (d < distance) {
      best = p
      distance = d
    }
  }
  return { ...best, clamped: true }
}

export const WALL_DETECTION_LIMITS = Object.freeze({
  minPoints: 20,
  minSupportRatio: 0.12,
  minWidth: 0.45,
  minHeight: 0.4,
  minFilledCells: 6,
  minAreaRatio: 0.35,
  maxPoints: 800,
  maxDistance: 7,
  confirmations: 3,
  stableAngleDegrees: 3,
  stableDepth: 0.04,
  featureViewpointShift: 0.06,
})

function fitVerticalPlane(points, cameraPosition) {
  const origin = points
    .reduce((s, p) => s.add(p), new Vector3())
    .multiplyScalar(1 / points.length)
  let xx = 0,
    xz = 0,
    zz = 0
  for (const p of points) {
    const x = p.x - origin.x,
      z = p.z - origin.z
    xx += x * x
    xz += x * z
    zz += z * z
  }
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz)
  const normal = new Vector3(-Math.sin(angle), 0, Math.cos(angle))
  if (normal.dot(cameraPosition.clone().sub(origin)) < 0) normal.negate()
  return { origin, normal }
}

// A large convex hull alone is not evidence of a surface. Two furniture edges
// or a thin diagonal strip can span both axes with no points between them.
function surfaceSupport(points, polygon, width, height) {
  const minX = Math.min(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const cells = Array(9).fill(0)
  for (const p of points) {
    const column = Math.min(2, Math.floor((3 * (p.x - minX)) / (width || 1)))
    const row = Math.min(2, Math.floor((3 * (p.y - minY)) / (height || 1)))
    cells[row * 3 + column]++
  }
  const occupied = cells.map((count) => count >= 2)
  const filledCells = occupied.filter(Boolean).length
  const spansAxes = [0, 1, 2].every(
    (i) =>
      [0, 1, 2].some((j) => occupied[i * 3 + j]) &&
      [0, 1, 2].some((j) => occupied[j * 3 + i]),
  )
  const areaRatio = polygonArea(polygon) / (width * height || 1)
  return {
    filledCells,
    areaRatio,
    supported:
      spansAxes &&
      filledCells >= WALL_DETECTION_LIMITS.minFilledCells &&
      areaRatio >= WALL_DETECTION_LIMITS.minAreaRatio,
  }
}

// The overlay and detector deliberately use the same finite, nearby sample.
export function sampleWallPoints(rawPoints, cameraPosition) {
  const points = []
  for (const raw of rawPoints) {
    const p = raw?.position || raw
    if (!p || !Number.isFinite(p.x + p.y + p.z)) continue
    const point = new Vector3().copy(p)
    if (point.distanceTo(cameraPosition) >= WALL_DETECTION_LIMITS.maxDistance)
      continue
    points.push(point)
    if (points.length === WALL_DETECTION_LIMITS.maxPoints) break
  }
  return points
}

/** RANSAC uses three independent points so horizontal floors cannot become walls.
 * Optional diagnostics describe this exact run, without changing its samples.
 */
export function detectVerticalWalls(
  rawPoints,
  cameraPosition,
  {
    random = Math.random,
    iterations = 110,
    tolerance = 0.035,
    diagnostics,
  } = {},
) {
  let remaining = sampleWallPoints(rawPoints, cameraPosition)
  // Keep this threshold relative to the original cloud, not the leftovers:
  // random slices through clutter must not become easier to accept on pass 3.
  const requiredPoints = Math.max(
    WALL_DETECTION_LIMITS.minPoints,
    Math.ceil(remaining.length * WALL_DETECTION_LIMITS.minSupportRatio),
  )
  if (diagnostics)
    Object.assign(diagnostics, {
      rawPoints: rawPoints.length,
      sampledPoints: remaining.length,
      verticalSamples: 0,
      bestInliers: 0,
      requiredPoints,
      candidates: [],
      status:
        remaining.length < WALL_DETECTION_LIMITS.minPoints
          ? 'few-points'
          : 'no-vertical-plane',
    })
  const walls = []
  for (
    let pass = 0;
    pass < 3 && remaining.length >= WALL_DETECTION_LIMITS.minPoints;
    pass++
  ) {
    let best = []
    for (let i = 0; i < iterations; i++) {
      const a = remaining[Math.floor(random() * remaining.length)]
      const b = remaining[Math.floor(random() * remaining.length)]
      const c = remaining[Math.floor(random() * remaining.length)]
      const ab = b.clone().sub(a),
        ac = c.clone().sub(a)
      const n = new Vector3().crossVectors(ab, ac)
      if (n.length() < 0.015) continue
      n.normalize()
      if (Math.abs(n.y) > 0.12) continue
      if (diagnostics) diagnostics.verticalSamples++
      n.y = 0
      n.normalize()
      const inliers = remaining.filter(
        (p) => Math.abs(n.dot(p.clone().sub(a))) <= tolerance,
      )
      if (inliers.length > best.length) best = inliers
    }
    if (diagnostics)
      diagnostics.bestInliers = Math.max(diagnostics.bestInliers, best.length)
    if (best.length < WALL_DETECTION_LIMITS.minPoints) break
    // Recheck support after least-squares fitting; the original RANSAC sample
    // and its refined plane do not necessarily have the same inliers.
    for (let refine = 0; refine < 2; refine++) {
      const fit = fitVerticalPlane(best, cameraPosition)
      const inliers = remaining.filter(
        (p) => Math.abs(fit.normal.dot(p.clone().sub(fit.origin))) <= tolerance,
      )
      if (inliers.length < WALL_DETECTION_LIMITS.minPoints) break
      best = inliers
    }
    const { origin: mean, normal: n } = fitVerticalPlane(best, cameraPosition)
    const right = new Vector3().crossVectors(UP, n)
    const projected = best.map((p) => ({
      x: p.clone().sub(mean).dot(right),
      y: p.y - mean.y,
    }))
    const xs = projected.map((p) => p.x),
      ys = projected.map((p) => p.y)
    const width = Math.max(...xs) - Math.min(...xs),
      height = Math.max(...ys) - Math.min(...ys)
    const residual = Math.sqrt(
      best.reduce((s, p) => s + n.dot(p.clone().sub(mean)) ** 2, 0) /
        best.length,
    )
    const polygon = convexHull(projected)
    const support = surfaceSupport(projected, polygon, width, height)
    const candidate = {
      origin: mean,
      normal: n,
      polygon,
      pointCount: best.length,
      residual,
      source: 'scan',
    }
    const accepted =
      best.length >= requiredPoints &&
      support.supported &&
      width >= WALL_DETECTION_LIMITS.minWidth &&
      height >= WALL_DETECTION_LIMITS.minHeight &&
      residual < tolerance * 0.8
    if (accepted) walls.push(candidate)
    if (diagnostics)
      diagnostics.candidates.push({
        ...candidate,
        width,
        height,
        filledCells: support.filledCells,
        areaRatio: support.areaRatio,
        accepted,
        reasons: [
          ...(best.length < requiredPoints ? ['weak-consensus'] : []),
          ...(!support.supported ? ['sparse-surface'] : []),
          ...(width < WALL_DETECTION_LIMITS.minWidth ? ['narrow'] : []),
          ...(height < WALL_DETECTION_LIMITS.minHeight ? ['short'] : []),
          ...(residual >= tolerance * 0.8 ? ['noisy'] : []),
        ],
      })
    const used = new Set(best)
    remaining = remaining.filter((p) => !used.has(p))
  }
  if (
    diagnostics &&
    diagnostics.sampledPoints >= WALL_DETECTION_LIMITS.minPoints
  ) {
    diagnostics.status = walls.length
      ? 'detected'
      : diagnostics.candidates.length
        ? 'rejected'
        : diagnostics.verticalSamples
          ? 'few-inliers'
          : 'no-vertical-plane'
  }
  return walls
}

// Keep the confirmed pose and grow its footprint with observations in that same basis.
// A partial view must never replace the previously observed part of a wall.
function extendObservedWall(wall, candidate) {
  const observed = makeWall(candidate)
  const polygon = convexHull([
    ...wall.polygon,
    ...observed.polygon.map((p) => localPoint(wall, worldPoint(observed, p))),
  ])
  if (
    polygon.length === wall.polygon.length &&
    polygon.every(
      (p, i) =>
        Math.abs(p.x - wall.polygon[i].x) < EPS &&
        Math.abs(p.y - wall.polygon[i].y) < EPS,
    )
  )
    return wall
  return makeWall({ ...wall, polygon })
}

function stableObservation(anchor, observed) {
  return (
    anchor.normal.dot(observed.normal) >=
      Math.cos((WALL_DETECTION_LIMITS.stableAngleDegrees * Math.PI) / 180) &&
    Math.abs(anchor.plane.distanceToPoint(observed.origin)) <=
      WALL_DETECTION_LIMITS.stableDepth &&
    Math.abs(observed.plane.distanceToPoint(anchor.origin)) <=
      WALL_DETECTION_LIMITS.stableDepth
  )
}

/** Confirm across updates; retain confirmed walls until the AR session/reset ends. */
export function createWallTracker() {
  let entries = [],
    counter = 0
  const confirmed = (entry) => entry.confirmed
  return {
    update(candidates, now, { cameraPosition } = {}) {
      // Only provisional candidates expire. Apply expiry before matching so old
      // one-off observations cannot eventually accumulate into a confirmed wall.
      entries = entries.filter((e) => confirmed(e) || now - e.updated < 2500)
      const seenThisUpdate = new Set()
      const observations = [...candidates].sort(
        (a, b) =>
          observationPriority(b) - observationPriority(a) ||
          (b.pointCount || 0) - (a.pointCount || 0),
      )
      for (const candidate of observations) {
        const matches = entries
          .map((entry) => ({ entry, match: wallMatch(entry.wall, candidate) }))
          .filter((item) => item.match)
          .sort(
            (a, b) =>
              Number(b.entry.locked) - Number(a.entry.locked) ||
              Number(confirmed(b.entry)) - Number(confirmed(a.entry)) ||
              Number(b.match === 'same') - Number(a.match === 'same'),
          )
        // A depth fluctuation in front of a remembered wall must not create a
        // nearer selectable surface, nor count toward confirming a noisy plane.
        let entry = matches[0]?.entry
        if (matches[0]?.match === 'duplicate') {
          if (
            !confirmed(entry) &&
            observationPriority(candidate) > observationPriority(entry.wall)
          ) {
            // A later native observation can replace an unconfirmed estimate.
            // Start its confirmations over; do not inherit the displaced pose's evidence.
            entry.wall = makeWall({ ...candidate, id: entry.wall.id })
            entry.seen = 0
          } else continue
        }
        if (!entry) {
          entry = {
            wall: makeWall({ ...candidate, id: `scan-${++counter}` }),
            seen: 0,
            updated: now,
            locked: false,
            confirmed: false,
          }
          entries.push(entry)
        }
        // A second estimate in the same update is not independent evidence.
        if (
          seenThisUpdate.has(entry) ||
          observationPriority(candidate) < observationPriority(entry.wall)
        )
          continue
        const observed = makeWall({ ...candidate, id: entry.wall.id })
        if (!confirmed(entry)) {
          // Compare every observation with the start of the streak, not with
          // the previous frame (which would allow an unstable plane to drift).
          if (!entry.seen || !stableObservation(entry.anchor, observed)) {
            entry.wall = observed
            entry.anchor = observed
            entry.seen = 0
            entry.firstCamera = cameraPosition?.clone()
            entry.viewpointShift = 0
          }
          if (entry.firstCamera && cameraPosition)
            entry.viewpointShift = Math.max(
              entry.viewpointShift,
              entry.firstCamera.distanceTo(cameraPosition),
            )
          entry.seen = Math.min(
            entry.seen + 1,
            WALL_DETECTION_LIMITS.confirmations,
          )
          // Feature points reprocessed from the same viewpoint are not a fresh
          // depth measurement. Ask for a small physical movement before fixing a wall.
          const viewpointReady =
            observed.source !== 'scan' ||
            !entry.firstCamera ||
            entry.viewpointShift >= WALL_DETECTION_LIMITS.featureViewpointShift
          entry.confirmed =
            entry.seen >= WALL_DETECTION_LIMITS.confirmations && viewpointReady
        }
        if (!entry.locked && stableObservation(entry.wall, observed))
          entry.wall = extendObservedWall(entry.wall, observed)
        seenThisUpdate.add(entry)
        entry.updated = now
      }
      for (const entry of entries)
        if (!confirmed(entry) && !seenThisUpdate.has(entry)) entry.seen = 0
      return entries.filter(confirmed).map((e) => e.wall)
    },
    snapshot() {
      return entries.map((e) => ({
        id: e.wall.id,
        confirmations: e.seen,
        locked: e.locked,
        confirmed: confirmed(e),
        needsViewpoint:
          !confirmed(e) &&
          e.seen >= WALL_DETECTION_LIMITS.confirmations &&
          !!e.firstCamera &&
          e.wall.source === 'scan',
      }))
    },
    lock(id) {
      const e = entries.find((e) => e.wall.id === id)
      if (e) e.locked = true
    },
    reset() {
      entries = []
      counter = 0
    },
  }
}
