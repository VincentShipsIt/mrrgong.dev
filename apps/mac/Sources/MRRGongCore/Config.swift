import Foundation

public struct ConfigError: Error, Equatable, LocalizedError {
    public var message: String
    public var errorDescription: String? { message }
}

public struct ServerConfig: Equatable, Sendable {
    public static let defaultURL = "http://localhost:8787"

    public var urlString: String
    public var token: String?

    public init(urlString: String, token: String?) {
        self.urlString = urlString
        self.token = token
    }

    /// `{server}/{path}` plus `?token=` when a token is set.
    public func url(path: String) throws -> URL {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var comps = URLComponents(string: trimmed),
              let scheme = comps.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = comps.host, !host.isEmpty
        else { throw ConfigError(message: "Server URL must start with http:// or https://") }
        var base = comps.path
        while base.hasSuffix("/") { base.removeLast() }
        comps.path = "\(base)/\(path)"
        comps.query = nil
        if let token, !token.isEmpty { comps.queryItems = [URLQueryItem(name: "token", value: token)] }
        guard let url = comps.url else { throw ConfigError(message: "Invalid server URL") }
        return url
    }
}

/// Exponential reconnect delay (seconds), capped.
public struct Backoff: Sendable {
    private let initial: Double
    private let maximum: Double
    private var current: Double

    public init(initial: Double = 1, maximum: Double = 30) {
        self.initial = initial
        self.maximum = maximum
        self.current = initial
    }

    public mutating func next() -> Double {
        defer { current = min(maximum, current * 2) }
        return current
    }

    public mutating func reset() { current = initial }
}
