import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyCover: UIView?

    // Cover secret-bearing views before the system takes an app-switcher snapshot.
    func sceneWillResignActive(_ scene: UIScene) {
        guard let window = window, privacyCover == nil else { return }
        let cover = UIView(frame: window.bounds)
        cover.backgroundColor = UIColor(red: 10 / 255.0, green: 23 / 255.0, blue: 32 / 255.0, alpha: 1)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.accessibilityLabel = "Latch locked"
        window.addSubview(cover)
        privacyCover = cover
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }


    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = LatchBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
