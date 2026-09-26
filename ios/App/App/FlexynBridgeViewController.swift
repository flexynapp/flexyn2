import UIKit
import Capacitor
import AuthenticationServices

/// The app's root view controller. Identical to Capacitor's own, plus the
/// registration of the plugins that live in this target rather than in npm.
/// SceneDelegate.swift creates it; Main.storyboard names it too.
class FlexynBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(FlexynAppleSignInPlugin())
    }
}

/// Native Sign in with Apple, exposed to JavaScript as `FlexynAppleSignIn`
/// (see src/lib/nativeAuth.js).
///
/// It lives here instead of coming from npm because the community plugin
/// pins Capacitor 7 in its Swift package and cannot resolve against
/// Capacitor 8. It does one thing: show Apple's sheet with the nonce it is
/// given and return the identity token. The token is exchanged for a Supabase
/// session in JavaScript (`signInWithIdToken`), so no secret lives here.
///
/// Requires the "Sign in with Apple" capability, which App.entitlements
/// declares; the App ID must have it enabled in the Apple Developer portal
/// before a signed build will carry it.
@objc(FlexynAppleSignInPlugin)
public class FlexynAppleSignInPlugin: CAPPlugin, CAPBridgedPlugin,
    ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {

    public let identifier = "FlexynAppleSignInPlugin"
    public let jsName = "FlexynAppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pendingCall: CAPPluginCall?

    /// JS: `authorize({ nonce })` where nonce is the SHA-256 hex of the raw
    /// nonce that will be handed to Supabase.
    @objc func authorize(_ call: CAPPluginCall) {
        guard let nonce = call.getString("nonce"), !nonce.isEmpty else {
            call.reject("A hashed nonce is required", "MISSING_NONCE")
            return
        }
        if pendingCall != nil {
            call.reject("An Apple sign-in is already in progress", "IN_PROGRESS")
            return
        }
        pendingCall = call

        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            request.nonce = nonce

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = bridge?.viewController?.view.window {
            return window
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first?.windows.first { $0.isKeyWindow } ?? UIWindow()
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pendingCall else { return }
        pendingCall = nil

        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple returned no identity token", "NO_TOKEN")
            return
        }

        var result: [String: Any] = [
            "identityToken": token,
            "user": credential.user
        ]
        if let codeData = credential.authorizationCode,
           let code = String(data: codeData, encoding: .utf8) {
            result["authorizationCode"] = code
        }
        // Apple sends email and name only on the FIRST authorisation.
        if let email = credential.email { result["email"] = email }
        if let given = credential.fullName?.givenName { result["givenName"] = given }
        if let family = credential.fullName?.familyName { result["familyName"] = family }
        call.resolve(result)
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithError error: Error) {
        guard let call = pendingCall else { return }
        pendingCall = nil

        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("The user canceled Sign in with Apple", "CANCELED", error)
            return
        }
        call.reject(error.localizedDescription, "FAILED", error)
    }
}
