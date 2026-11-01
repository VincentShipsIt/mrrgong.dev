import Foundation
import Security

public protocol TokenStoring: Sendable {
    func readToken() -> String?
    func writeToken(_ token: String?)
}

/// Generic-password Keychain item; the token never touches UserDefaults.
public struct KeychainTokenStore: TokenStoring {
    private let service: String
    private let account = "server-token"

    public init(service: String = "dev.mrrgong.app") {
        self.service = service
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    public func readToken() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func writeToken(_ token: String?) {
        SecItemDelete(query as CFDictionary)
        guard let token, !token.isEmpty, let data = token.data(using: .utf8) else { return }
        var q = query
        q[kSecValueData as String] = data
        SecItemAdd(q as CFDictionary, nil)
    }
}

/// Server URL and mute live in UserDefaults; the token lives behind `TokenStoring`.
public final class AppSettings {
    private enum Key {
        static let url = "serverURL"
        static let muted = "muted"
    }

    private let defaults: UserDefaults
    private let tokens: TokenStoring

    public init(defaults: UserDefaults = .standard, tokens: TokenStoring = KeychainTokenStore()) {
        self.defaults = defaults
        self.tokens = tokens
    }

    public var serverURL: String {
        get {
            let stored = defaults.string(forKey: Key.url)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return stored.isEmpty ? ServerConfig.defaultURL : stored
        }
        set { defaults.set(newValue.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Key.url) }
    }

    public var token: String? {
        get { tokens.readToken() }
        set {
            let trimmed = newValue?.trimmingCharacters(in: .whitespacesAndNewlines)
            tokens.writeToken(trimmed?.isEmpty == false ? trimmed : nil)
        }
    }

    public var muted: Bool {
        get { defaults.bool(forKey: Key.muted) }
        set { defaults.set(newValue, forKey: Key.muted) }
    }

    public var config: ServerConfig { ServerConfig(urlString: serverURL, token: token) }
}
