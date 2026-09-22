export const arBackend = () =>
  /Android/i.test(navigator.userAgent) ? 'webxr' : '8thwall'

export const WEBXR_UNAVAILABLE =
  'この端末・ブラウザではWebXR ARを利用できません。ARCore対応のAndroid端末でChromeを開き、Google Play開発者サービス（AR）を更新してください。ルームプレビューは引き続き利用できます。'

export async function prepareWebXR() {
  if (
    !navigator.xr?.isSessionSupported ||
    !(await navigator.xr.isSessionSupported('immersive-ar'))
  )
    throw new Error(WEBXR_UNAVAILABLE)
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
