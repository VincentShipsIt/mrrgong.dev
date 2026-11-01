import Foundation

public enum MRRFetchError: Error, Equatable, Sendable {
    case watcherOff
    case noDataYet
    case unauthorized
    case badResponse
    case unreachable(String)

    /// Maps the HTTP statuses the server uses for /mrr and /events.
    static func from(status: Int) -> MRRFetchError? {
        switch status {
        case 200: nil
        case 401: .unauthorized
        case 404: .watcherOff
        case 503: .noDataYet
        default: .badResponse
        }
    }
}

public protocol MRRFetching: Sendable {
    func fetchMRR(config: ServerConfig) async throws -> MRRSummary
}

public struct MRRClient: MRRFetching {
    private let session: URLSession

    public init(session: URLSession = MRRClient.makeSession()) {
        self.session = session
    }

    public static func makeSession() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 15
        return URLSession(configuration: cfg)
    }

    public func fetchMRR(config: ServerConfig) async throws -> MRRSummary {
        let url: URL
        do { url = try config.url(path: "mrr") } catch { throw MRRFetchError.unreachable(error.localizedDescription) }
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw MRRFetchError.unreachable(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw MRRFetchError.badResponse }
        if let failure = MRRFetchError.from(status: http.statusCode) { throw failure }
        guard let summary = try? JSONDecoder().decode(MRRSummary.self, from: data) else { throw MRRFetchError.badResponse }
        return summary
    }
}

public enum SSEStreamEvent: Equatable, Sendable {
    /// The connection was accepted (HTTP 200); the server is reachable.
    case open
    case message(SSEMessage)
}

public protocol EventStreaming: Sendable {
    func stream(config: ServerConfig) -> AsyncThrowingStream<SSEStreamEvent, Error>
}

public struct SSEClient: EventStreaming {
    private let session: URLSession

    public init(session: URLSession = SSEClient.makeSession()) {
        self.session = session
    }

    public static func makeSession() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 300 // idle timeout; the server pings far more often
        cfg.timeoutIntervalForResource = .infinity
        return URLSession(configuration: cfg)
    }

    public func stream(config: ServerConfig) -> AsyncThrowingStream<SSEStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: try config.url(path: "events"))
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.timeoutInterval = 300
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw MRRFetchError.badResponse }
                    if let failure = MRRFetchError.from(status: http.statusCode) { throw failure }
                    continuation.yield(.open)
                    var parser = SSEParser()
                    var buffer = Data()
                    for try await byte in bytes {
                        buffer.append(byte)
                        guard byte == 0x0A || byte == 0x0D else { continue }
                        for message in parser.feed(buffer) { continuation.yield(.message(message)) }
                        buffer.removeAll(keepingCapacity: true)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
