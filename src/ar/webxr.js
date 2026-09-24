import {
  depthWorldPoints,
  planeCandidates,
  horizontalPlaneCandidates,
  verticalHit,
  createHitCloud,
} from './webxr-geometry.js'
import { webXRError } from './platform.js'

/** One WebXR session. All XRFrame reads happen inside its animation callback. */
export function createWebXRSession({
  renderer,
  scene,
  camera,
  overlay,
  onFrame,
  onEnd,
  onError,
  onReset,
}) {
  let session,
    referenceSpace,
    stopped = false,
    ended = false
  let sources = [],
    lastSample = -Infinity,
    points = [],
    planes = [],
    boundaries = []
  let depthState = 'unavailable',
    pointSource = 'hit-test',
    depthError = '',
    cpuDepth = false
  const hits = createHitCloud()
  const reset = () => {
    hits.clear()
    points = []
    planes = []
    boundaries = []
    lastSample = -Infinity
  }
  const referenceReset = () => {
    reset()
    onReset()
  }
  const end = () => {
    ended = true
    cleanup()
    onEnd()
  }
  const preventXRSelect = (event) => event.preventDefault()
  function cleanup() {
    renderer.setAnimationLoop(null)
    sources.forEach((source) => source.cancel())
    sources = []
    referenceSpace?.removeEventListener('reset', referenceReset)
    session?.removeEventListener('end', end)
    overlay.removeEventListener('beforexrselect', preventXRSelect)
    reset()
  }
  async function stop() {
    stopped = true
    cleanup()
    if (session && !ended) {
      ended = true
      await session.end().catch(() => {})
    }
  }
  async function start() {
    try {
      // Keep requestSession on the user-click call stack; never await a support check here.
      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['local', 'hit-test', 'dom-overlay'],
        optionalFeatures: ['depth-sensing', 'plane-detection'],
        domOverlay: { root: overlay },
        depthSensing: {
          usagePreference: ['cpu-optimized'],
          dataFormatPreference: ['luminance-alpha', 'float32'],
        },
      })
      if (stopped) {
        await stop()
        return false
      }
      session.addEventListener('end', end)
      if (!session.domOverlayState)
        throw new Error(
          'このブラウザではAR中の操作画面を表示できません。AndroidのChromeを更新してください。',
        )
      renderer.xr.enabled = true
      renderer.xr.setReferenceSpaceType('local')
      await renderer.xr.setSession(session)
      if (stopped || ended) {
        await stop()
        return false
      }
      referenceSpace = renderer.xr.getReferenceSpace()
      referenceSpace.addEventListener('reset', referenceReset)
      const viewer = await session.requestReferenceSpace('viewer')
      if (stopped || ended) {
        await stop()
        return false
      }
      const center = await session.requestHitTestSource({
        space: viewer,
        entityTypes: ['plane'],
      })
      if (stopped || ended) {
        center.cancel()
        await stop()
        return false
      }
      sources.push(center)
      // A small fan of real hit tests helps devices without Depth observe enough wall area.
      if (typeof XRRay !== 'undefined') {
        for (const [x, y] of [
          [-0.25, -0.25],
          [0.25, -0.25],
          [-0.25, 0.25],
          [0.25, 0.25],
        ]) {
          let source
          try {
            source = await session.requestHitTestSource({
              space: viewer,
              entityTypes: ['plane'],
              offsetRay: new XRRay({}, { x, y, z: -1, w: 0 }),
            })
          } catch {
            break
          } // Some runtimes limit the number of sources.
          if (stopped || ended) {
            source.cancel()
            await stop()
            return false
          }
          sources.push(source)
        }
      }
      // The depthUsage getter throws InvalidStateError when the optional feature
      // was not granted (rather than returning null).
      try {
        cpuDepth = session.depthUsage === 'cpu-optimized'
      } catch {
        cpuDepth = false
      }
      depthState = cpuDepth ? 'waiting' : 'unavailable'
      overlay.addEventListener('beforexrselect', preventXRSelect)
      renderer.setAnimationLoop((time, frame) => {
        if (stopped || ended || !frame) return
        try {
          const pose = frame.getViewerPose(referenceSpace)
          const view = pose?.views[0]
          const tracking =
            !!view &&
            !pose.emulatedPosition &&
            session.visibilityState === 'visible'
          if (tracking) {
            camera.matrix.fromArray(view.transform.matrix)
            camera.matrix.decompose(
              camera.position,
              camera.quaternion,
              camera.scale,
            )
            camera.projectionMatrix.fromArray(view.projectionMatrix)
            camera.projectionMatrixInverse
              .copy(camera.projectionMatrix)
              .invert()
            camera.updateMatrixWorld(true)
            if (time - lastSample >= 200) {
              lastSample = time
              planes = planeCandidates(frame, referenceSpace, camera.position)
              boundaries = horizontalPlaneCandidates(
                frame,
                referenceSpace,
                camera.position,
              )
              for (const source of sources) {
                for (const result of frame.getHitTestResults(source)) {
                  const hit = verticalHit(
                    result.getPose(referenceSpace),
                    camera.position,
                  )
                  if (hit) {
                    hits.add(hit, time)
                    break
                  }
                }
              }
              let depthPoints = []
              if (cpuDepth && frame.getDepthInformation) {
                try {
                  depthPoints = depthWorldPoints(
                    frame.getDepthInformation(view),
                    view,
                  )
                  depthState = depthPoints.length ? 'active' : 'waiting'
                  depthError = ''
                } catch (error) {
                  depthState = 'error'
                  depthError = error.name || 'DepthError'
                }
              }
              pointSource = depthPoints.length >= 20 ? 'depth' : 'hit-test'
              points =
                pointSource === 'depth'
                  ? depthPoints
                  : hits.points(time, camera.position)
            }
          } else {
            reset()
            if (cpuDepth) depthState = 'waiting'
          }
          onFrame({
            trackingStatus: tracking ? 'NORMAL' : 'LIMITED',
            trackingReason:
              session.visibilityState !== 'visible'
                ? session.visibilityState
                : pose?.emulatedPosition
                  ? 'EMULATED_POSITION'
                  : tracking
                    ? ''
                    : 'POSE_UNAVAILABLE',
            worldPoints: points,
            nativeWalls: planes,
            nativeBoundaries: boundaries,
            webxr: {
              depth: depthState,
              depthError,
              pointSource,
              nativePlaneCount: planes.length,
              hitTestSources: sources.length,
            },
          })
          if (tracking) renderer.render(scene, camera)
          else {
            // Three.js retains the last camera when pose is absent. Clear the XR layer
            // so old art/debug geometry cannot remain frozen over the camera feed.
            renderer.clear()
          }
        } catch (error) {
          onError(webXRError(error))
          void stop()
          onEnd()
        }
      })
      return true
    } catch (error) {
      await stop()
      throw new Error(webXRError(error))
    }
  }
  return { start, stop, reset }
}
