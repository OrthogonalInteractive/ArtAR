import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
const window = new EventTarget()
const document = new EventTarget()
window.innerWidth = 360
window.innerHeight = 640
const sizes = []
let timeoutCallback
const schedule = callback => { timeoutCallback = callback; return 1 }
const cancel = () => { timeoutCallback = undefined }
let classOn = false, sent = [], frames = [], rendered = 0, cleared = 0, ended = 0, reset = 0
window.webkit = { messageHandlers: { artarAR: { postMessage: p => sent.push(p) } } }
document.documentElement = { classList: { add() { classOn = true }, remove() { classOn = false } } }
class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail } }
const context = vm.createContext({ window, document, crypto: webcrypto, setTimeout: schedule, clearTimeout: cancel, CustomEvent })
const module = new vm.SourceTextModule(fs.readFileSync(fileURLToPath(new URL('../src/ar/arkit.js', import.meta.url)), 'utf8'), { context })
// Geometry is stubbed here; Vitest covers actual Three.js plane conversion.
await module.link(() => new vm.SyntheticModule(['planeCandidates', 'horizontalPlaneCandidates'], function() {
  this.setExport('planeCandidates', () => [])
  this.setExport('horizontalPlaneCandidates', () => [])
}, { context }))
await module.evaluate()
const camera = { matrix: { fromArray() {}, decompose() {} }, projectionMatrix: { fromArray() {} },
  projectionMatrixInverse: { copy() { return this }, invert() {} }, updateMatrixWorld() {}, position: {} }
const options = { camera, scene: {}, renderer: { clear() { cleared++ }, render() { rendered++ }, setAnimationLoop() {}, setSize(...size) { sizes.push(size) } },
  onFrame(p) { frames.push(p) }, onEnd() { ended++ }, onReset() { reset++ }, onError() {} }
const make = module.namespace.createARKitSession
const identity = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
const emit = p => window.dispatchEvent(new CustomEvent('artar-arkit', { detail: { id: sent.at(-1).id, ...p } }))
const frame = p => emit({ type: 'frame', tracking: 'normal', camera: identity, projection: identity, planes: [], ...p })
let driver = make(options), pending = driver.start()
frame({ id: 'stale' }); assert.equal(rendered, 0)
frame({ planes: [null, {}] }); assert.equal(await pending, true); assert.equal(rendered, 1); assert.equal(classOn, true)
emit({ type: 'frame', tracking: 'interrupted' }); assert.equal(cleared, 1); assert.equal(frames.at(-1).trackingStatus, 'LIMITED')
emit({ type: 'reset' }); assert.equal(reset, 1)
window.innerWidth = 640; window.innerHeight = 360
frame({ planes: {} }); assert.deepEqual(sizes.at(-1), [640, 360, false])
const count = sizes.length; frame(); assert.equal(sizes.length, count)
const renderCount = rendered
const id = sent.at(-1).id
await driver.stop(); assert.equal(classOn, false)
frame({ id }); assert.equal(rendered, renderCount)
driver = make(options); pending = driver.start(); await driver.stop(); assert.equal(await pending, false)
driver = make(options); pending = driver.start(); const rejected = assert.rejects(pending, /permission/)
emit({ type: 'error', message: 'permission denied' }); await rejected; assert.equal(classOn, false)
driver = make(options); pending = driver.start()
const timedOut = assert.rejects(pending, /応答/)
frame({ tracking: 'limited' }); assert.equal(classOn, true)
timeoutCallback(); await timedOut; assert.equal(classOn, false)
driver = make(options); pending = driver.start(); frame(); await pending
options.renderer.render = () => { throw new Error('render failed') }
frame(); assert.equal(ended, 1); assert.equal(classOn, false)
driver = make(options);
window.webkit.messageHandlers.artarAR.postMessage = () => { throw new Error('transport failure') };
await assert.rejects(driver.start(), /transport/); await driver.stop(); assert.equal(classOn, false);
console.log('ARKit bridge lifecycle: passed (startup, stale packets, tracking loss, reset, stop, startup cancellation, permission failure, malformed planes, rotation, timeout, render failure, transport failure)')
const platform = await import('../src/ar/platform.js')
globalThis.window = window
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'iPhone', platform: 'iPhone' } })
assert.equal(platform.arBackend(), 'arkit')
delete window.webkit
assert.equal(platform.arBackend(), '8thwall')
navigator.xr = { requestSession() {} }
assert.equal(platform.arBackend(), 'webxr')
await assert.rejects(platform.prepareWebXR(), /iPhone/)
navigator.userAgent = 'Android Chrome'; delete navigator.xr
assert.equal(platform.arBackend(), 'webxr')
console.log('Platform routing: passed (ARKit companion, Safari fallback, iOS WebXR, unsupported iOS, Android)')
