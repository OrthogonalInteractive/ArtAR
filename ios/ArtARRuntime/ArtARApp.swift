import SwiftUI
import UIKit
import simd
import ARKit
import WebKit
import SceneKit

@main
struct ArtARApp: App {
    var body: some Scene {
        WindowGroup { RuntimeView().ignoresSafeArea() }
    }
}

struct RuntimeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> RuntimeController { RuntimeController() }
    func updateUIViewController(_ controller: RuntimeController, context: Context) {}
}

// The native camera stays in ARSCNView. Only pose and observed plane polygons
// are delivered to the trusted main-frame website, never camera images.
final class RuntimeController: UIViewController, WKScriptMessageHandler,
    WKNavigationDelegate, ARSessionDelegate {
    private let cameraView = ARSCNView()
    private var webView: WKWebView!
    private var sessionID: String?
    private var lastFrame: TimeInterval = 0
    private var paused = false
    private let page = URL(string: Bundle.main.object(forInfoDictionaryKey: "ArtARPageURL") as! String)!

    override func viewDidLoad() {
        super.viewDidLoad()
        cameraView.frame = view.bounds
        cameraView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cameraView.scene = SCNScene()
        cameraView.session.delegate = self
        cameraView.session.delegateQueue = .main
        cameraView.isHidden = true
        view.addSubview(cameraView)
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(WeakScriptHandler(self), name: "artarAR")
        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.navigationDelegate = self
        view.addSubview(webView)
        webView.load(URLRequest(url: page))
        NotificationCenter.default.addObserver(self, selector: #selector(suspend),
            name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resume),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func trusted(_ url: URL?) -> Bool {
        guard let url else { return false }
        return url.scheme == "https" && url.host == page.host && url.port == page.port
            && url.path.hasPrefix(page.path)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Do not expose the bridge to external pages, frames or popups.
        decisionHandler(action.targetFrame?.isMainFrame == true && trusted(action.request.url)
            ? .allow : .cancel)
    }

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let id = body["id"] as? String,
              id.count <= 80, let action = body["action"] as? String else { return }
        switch action {
        case "start":
            guard sessionID == nil else { return }
            sessionID = id
            guard ARWorldTrackingConfiguration.isSupported else {
                emit(["type": "error", "message": "この端末はARKitに対応していません。"])
                stop(); return
            }
            cameraView.isHidden = false
            run(reset: true)
        case "stop": if sessionID == id { stop() }
        case "reset":
            if sessionID == id { emit(["type": "reset"]); run(reset: true) }
        default: break
        }
    }

    private func run(reset: Bool) {
        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal, .vertical]
        configuration.worldAlignment = .gravity
        lastFrame = 0
        cameraView.session.run(configuration,
            options: reset ? [.resetTracking, .removeExistingAnchors] : [])
    }

    private func stop() {
        cameraView.session.pause()
        cameraView.isHidden = true
        sessionID = nil
        paused = false
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        cameraView.session.pause()
    }

    @objc private func suspend() {
        guard sessionID != nil else { return }
        paused = true
        cameraView.session.pause()
        emit(["type": "frame", "tracking": "interrupted"])
    }

    @objc private func resume() {
        guard sessionID != nil, paused else { return }
        paused = false
        emit(["type": "reset"])
        run(reset: true)
    }

    private func emit(_ data: [String: Any]) {
        guard let id = sessionID, trusted(webView.url) else { return }
        var packet = data
        packet["id"] = id
        // Structured arguments avoid script interpolation and escaping issues.
        webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('artar-arkit', {detail: packet}))",
            arguments: ["packet": packet], in: nil, in: .page,
            completionHandler: nil)
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        // Delegate delivery is explicitly on main. Avoid queueing old frames
        // behind stop/reset/start operations and tagging them as a new session.
        deliver(frame)
    }

    private func deliver(_ frame: ARFrame) {
        guard sessionID != nil, !paused, frame.timestamp - lastFrame >= 1.0 / 30.0 else { return }
        lastFrame = frame.timestamp
        let orientation = view.window?.windowScene?.interfaceOrientation ?? .portrait
        let pose = simd_inverse(frame.camera.viewMatrix(for: orientation))
        let projection = frame.camera.projectionMatrix(for: orientation,
            viewportSize: view.bounds.size, zNear: 0.05, zFar: 30)
        let tracking: String
        switch frame.camera.trackingState {
        case .normal: tracking = "normal"
        case .notAvailable: tracking = "unavailable"
        case .limited: tracking = "limited"
        }
        let planes: [[String: Any]] = frame.anchors.compactMap { anchor -> [String: Any]? in
            guard let plane = anchor as? ARPlaneAnchor else { return nil }
            let geometry = plane.geometry
            guard geometry.boundaryVertexCount >= 3, geometry.boundaryVertexCount <= 2048 else { return nil }
            let polygon = (0..<geometry.boundaryVertexCount).map { index -> [String: Float] in
                let p = geometry.boundaryVertices[index]
                return ["x": p.x, "y": p.y, "z": p.z]
            }
            let label: String
            switch plane.classification {
            case .floor: label = "floor"
            case .ceiling: label = "ceiling"
            case .wall: label = "wall"
            case .none: label = ""
            default: label = "other"
            }
            return ["transform": values(plane.transform), "polygon": polygon,
                "orientation": plane.alignment == .vertical ? "vertical" : "horizontal",
                "semanticLabel": label]
        }
        emit(["type": "frame", "tracking": tracking, "camera": values(pose),
            "projection": values(projection), "planes": planes])
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        DispatchQueue.main.async { [weak self] in
            self?.emit(["type": "error", "message": "ARKitを開始できませんでした。設定でカメラ権限を確認してください。"])
            self?.stop()
        }
    }
    func sessionWasInterrupted(_ session: ARSession) {
        DispatchQueue.main.async { [weak self] in self?.suspend() }
    }
    func sessionInterruptionEnded(_ session: ARSession) {
        DispatchQueue.main.async { [weak self] in self?.resume() }
    }
    private func values(_ matrix: simd_float4x4) -> [Float] {
        [matrix.columns.0, matrix.columns.1, matrix.columns.2, matrix.columns.3]
            .flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }
}

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var delegate: WKScriptMessageHandler?
    init(_ delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        delegate?.userContentController(controller, didReceive: message)
    }
}
