import { planeCandidates, horizontalPlaneCandidates } from './webxr-geometry.js'

const matrix = (value) =>
  Array.isArray(value) && value.length === 16 && value.every(Number.isFinite)

/** Native camera underneath a transparent web view. Camera images and raw
 * feature points never cross this bridge.
 */
export function createARKitSession({
  renderer, scene, camera, onFrame, onEnd, onError, onReset,
}) {
  let stopped = false, started = false, timer, resolveStart, rejectStart, startup
  let width, height
  const id = crypto.randomUUID()
  const bridge = window.webkit.messageHandlers.artarAR
  const send = (action) => bridge.postMessage({ action, id })
  const cleanup = () => {
    clearTimeout(timer)
    window.removeEventListener('artar-arkit', receive)
    document.removeEventListener('visibilitychange', visibility)
    renderer.setAnimationLoop(null)
    document.documentElement.classList.remove('arkit-active')
  }
  // Native transport may disappear during navigation or an interruption. Local
  // cleanup must still finish, without an unhandled rejected stop promise.
  function stop() {
    if (stopped) return Promise.resolve()
    stopped = true
    cleanup()
    resolveStart?.(false)
    try { send('stop') } catch { /* The native view may already be gone. */ }
    return Promise.resolve()
  }
  function fail(error) {
    const wasStarted = started
    rejectStart?.(error)
    void stop()
    if (wasStarted) {
      onError(error.message)
      onEnd()
    }
  }
  const limited = (reason) => {
    renderer.clear()
    onFrame({
      trackingStatus: 'LIMITED', trackingReason: reason,
      worldPoints: [], nativeWalls: [], nativeBoundaries: [],
      webxr: { depth: 'unavailable', pointSource: 'arkit-plane' },
    })
  }
  function visibility() {
    if (document.hidden && !stopped) {
      try { limited('HIDDEN') } catch (error) { fail(error) }
    }
  }
  function receive(event) {
    const packet = event.detail
    if (stopped || packet?.id !== id) return
    try { processPacket(packet) } catch (error) { fail(error) }
  }
  function processPacket(packet) {
    if (packet.type === 'error') {
      fail(new Error(packet.message || 'ARKitを開始できませんでした。'))
      return
    }
    if (packet.type === 'end') {
      void stop()
      onEnd()
      return
    }
    if (packet.type === 'reset') { onReset(); return }
    if (packet.type !== 'frame') return
    if (packet.tracking !== 'normal' && !matrix(packet.camera)) {
      limited(packet.tracking || 'POSE_UNAVAILABLE')
      return
    }
    if (!matrix(packet.camera) || !matrix(packet.projection)) return
    if (document.hidden || packet.tracking !== 'normal') {
      // Wait for a usable pose before declaring startup successful.
      limited(packet.tracking || 'POSE_UNAVAILABLE')
      return
    }
    camera.matrix.fromArray(packet.camera)
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale)
    camera.projectionMatrix.fromArray(packet.projection)
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.updateMatrixWorld(true)
    // A non-XR renderer does not get WebXR's automatic viewport updates.
    // Keep its buffer aligned with ARKit on device rotation and window resize.
    const nextWidth = window.innerWidth, nextHeight = window.innerHeight
    if (nextWidth !== width || nextHeight !== height) {
      renderer.setSize(nextWidth, nextHeight, false)
      width = nextWidth; height = nextHeight
    }
    // ARPlaneAnchor local XZ polygons match WebXR's plane convention.
    const planes = (Array.isArray(packet.planes) ? packet.planes : []).filter(p =>
      p && matrix(p.transform) && ['vertical', 'horizontal'].includes(p.orientation) &&
      Array.isArray(p.polygon) && p.polygon.length >= 3 && p.polygon.length <= 2048 &&
      p.polygon.every(v => v && [v.x, v.y, v.z].every(Number.isFinite)))
    const frame = {
      detectedPlanes: planes.map(p => ({ ...p, planeSpace: p.transform })),
      getPose: transform => ({ transform: { matrix: transform } }),
    }
    const walls = planeCandidates(frame, null, camera.position)
    const boundaries = horizontalPlaneCandidates(frame, null, camera.position)
    for (const plane of [...walls, ...boundaries]) plane.source = 'arkit-plane'
    onFrame({
      trackingStatus: 'NORMAL', trackingReason: '', worldPoints: [],
      nativeWalls: walls, nativeBoundaries: boundaries,
      webxr: { depth: 'unavailable', pointSource: 'arkit-plane',
        nativePlaneCount: walls.length, hitTestSources: 0 },
    })
    renderer.render(scene, camera)
    if (!started) {
      started = true
      clearTimeout(timer)
      resolveStart(true)
    }
  }
  function start() {
    if (stopped) return Promise.resolve(false)
    if (startup) return startup
    startup = new Promise((resolve, reject) => {
      resolveStart = resolve; rejectStart = reject
      window.addEventListener('artar-arkit', receive)
      document.documentElement.classList.add('arkit-active')
      document.addEventListener('visibilitychange', visibility)
      timer = setTimeout(() => {
        fail(new Error('ARKitから応答がありません。カメラ権限を確認してください。'))
      }, 20000)
      try { send('start') } catch (error) { fail(error) }
    })
    return startup
  }
  return {
    start, stop,
    reset() {
      if (!stopped) {
        try { send('reset') } catch (error) { fail(error) }
      }
    },
  }
}
