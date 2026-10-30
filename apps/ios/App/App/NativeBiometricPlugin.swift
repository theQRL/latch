import UIKit
import Capacitor
import LocalAuthentication
import Security

class LatchBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeBiometricPlugin())
        bridge?.registerPluginInstance(ScreenAwakePlugin())
    }
}

@objc(NativeBiometricPlugin)
public class NativeBiometricPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeBiometricPlugin"
    public let jsName = "LatchBiometrics"
    public let pluginMethods: [CAPPluginMethod] = ["availability", "enroll", "unlock", "remove", "cancel", "wipe"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let service = "org.theqrl.latch.biometric.v1"
    private var pending: CAPPluginCall?
    private var context: LAContext?
    private var staged: String?
    private func query(_ id: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: id, kSecAttrSynchronizable as String: false]
    }
    private func credential(_ call: CAPPluginCall) -> String? {
        guard let id = call.getString("credential"), UUID(uuidString: id) != nil else { return nil }
        return id
    }
    @objc func availability(_ call: CAPPluginCall) {
        let ctx = LAContext()
        let available = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        call.resolve(["available": available, "label": ctx.biometryType == .faceID ? "Face ID" : ctx.biometryType == .touchID ? "Touch ID" : "Biometric unlock",
                      "reason": available ? "" : "Enable biometrics in Settings, or use your vault passphrase."])
    }
    @objc func enroll(_ call: CAPPluginCall) { DispatchQueue.main.async { self.start(call, create: true) } }
    @objc func unlock(_ call: CAPPluginCall) { DispatchQueue.main.async { self.start(call, create: false) } }
    private func start(_ call: CAPPluginCall, create: Bool) {
        guard pending == nil else { call.reject("Another biometric request is open"); return }
        let ctx = LAContext()
        ctx.localizedFallbackTitle = ""
        ctx.localizedCancelTitle = "Use vault passphrase"
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil),
              let id = create ? UUID().uuidString : credential(call) else {
            call.reject("Biometrics unavailable. Use your vault passphrase."); return
        }
        if create {
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil) else {
                call.reject("Device key protection unavailable"); return
            }
            var secret = Data(count: 32)
            defer { secret.resetBytes(in: 0..<secret.count) }
            let randomStatus = secret.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
            guard randomStatus == errSecSuccess else { call.reject("Could not generate device key"); return }
            var item = query(id)
            item[kSecAttrAccessControl as String] = access
            item[kSecValueData as String] = secret
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { call.reject("Could not store device key"); return }
            staged = id
        }
        pending = call; context = ctx
        var item = query(id)
        item[kSecReturnData as String] = true
        item[kSecMatchLimit as String] = kSecMatchLimitOne
        item[kSecUseAuthenticationContext as String] = ctx
        item[kSecUseOperationPrompt as String] = "Unlock your Latch vault"
        DispatchQueue.global(qos: .userInitiated).async {
            var result: CFTypeRef?
            let status = SecItemCopyMatching(item as CFDictionary, &result)
            DispatchQueue.main.async {
                var secret = result as? Data ?? Data()
                defer { secret.resetBytes(in: 0..<secret.count) }
                guard self.pending === call else { return }
                guard status == errSecSuccess, secret.count == 32 else {
                    self.abort("Biometric authentication cancelled or unavailable. Use your vault passphrase."); return
                }
                self.pending = nil; self.context = nil; self.staged = nil
                ctx.invalidate()
                call.resolve(["credential": id, "secret": secret.base64EncodedString()])
            }
        }
    }
    private func abort(_ message: String) {
        context?.invalidate(); context = nil
        if let id = staged { SecItemDelete(query(id) as CFDictionary) }
        staged = nil
        let call = pending; pending = nil
        call?.reject(message)
    }
    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.abort("Biometric request cancelled. Use your vault passphrase."); call.resolve() }
    }
    @objc func remove(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pending == nil, let id = self.credential(call) else { call.reject("Invalid or pending biometric request"); return }
            let status = SecItemDelete(self.query(id) as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Could not remove biometric key"); return }
            call.resolve()
        }
    }
    @objc func wipe(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.abort("Device reset");
            let item: [String: Any] = [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:self.service]
            let status = SecItemDelete(item as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { call.reject("Device keys could not be removed"); return }
            call.resolve()
        }
    }

}


@objc(ScreenAwakePlugin)
public class ScreenAwakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScreenAwakePlugin"
    public let jsName = "LatchScreenAwake"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise)]
    private var inactiveObserver: NSObjectProtocol?
    private var activeObserver: NSObjectProtocol?
    private var requested = false
    public override func load() {
        inactiveObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in
            UIApplication.shared.isIdleTimerDisabled = false
        }
        activeObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            UIApplication.shared.isIdleTimerDisabled = self?.requested ?? false
        }
    }
    @objc func setEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            self.requested = enabled
            UIApplication.shared.isIdleTimerDisabled = enabled && UIApplication.shared.applicationState == .active
            call.resolve()
        }
    }
    deinit {
        if let observer = inactiveObserver { NotificationCenter.default.removeObserver(observer) }
        if let observer = activeObserver { NotificationCenter.default.removeObserver(observer) }
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false }
    }
}
