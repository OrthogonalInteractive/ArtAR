export const isIOS = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

// Only the companion native runtime installs this message handler.
// A query parameter alone must never enable the ARKit path in Safari.
export const hasARKitBridge = () =>
  isIOS() &&
  typeof window.webkit?.messageHandlers?.artarAR?.postMessage === 'function'

export const arkitRequired = () => import.meta.env?.VITE_REQUIRE_ARKIT === 'true'
export const ARKIT_REQUIRED_MESSAGE =
  'このテスト版はARKit専用です。TestFlightからArtARのApp Clipを起動してください。SafariではARKitを利用できません。'
export const arRequirementError = () =>
  arkitRequired() && !hasARKitBridge() ? ARKIT_REQUIRED_MESSAGE : null

export const arBackend = () => {
  if (hasARKitBridge()) return 'arkit'
  if (/Android/i.test(navigator.userAgent)) return 'webxr'
  if (isIOS() && navigator.xr?.requestSession) return 'webxr'
  return '8thwall'
}

export const WEBXR_UNAVAILABLE =
  'この端末・ブラウザではWebXR ARを利用できません。ARCore対応のAndroid端末でChromeを開き、Google Play開発者サービス（AR）を更新してください。ルームプレビューは引き続き利用できます。'

export async function prepareWebXR() {
  if (
    !navigator.xr?.isSessionSupported ||
    !(await navigator.xr.isSessionSupported('immersive-ar'))
  )
    throw new Error(isIOS()
      ? 'このiPhone / iPadの実行環境ではWebXR ARを利用できません。ARKit対応の実行環境で開いてください。ルームプレビューは引き続き利用できます。'
      : WEBXR_UNAVAILABLE)
}

export function webXRError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError')
    return 'ARの開始が許可されませんでした。Chromeのカメラ・AR権限を確認し、「カメラを開始」から再試行してください。'
  if (error?.name === 'NotSupportedError') return WEBXR_UNAVAILABLE
  return (
    error?.message ||
    'WebXRを開始できませんでした。Chromeで再試行してください。'
  )
}

