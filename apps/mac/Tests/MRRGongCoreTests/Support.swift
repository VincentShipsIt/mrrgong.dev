import Foundation
@testable import MRRGongCore

/// URLProtocol stub: set `handler` per test, it receives the request and returns (status, body).
final class StubURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?
    nonisolated(unsafe) static var lastRequest: URLRequest?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        do {
            let (status, body) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    static func session() -> URLSession {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: cfg)
    }
}

final class FakeFetcher: MRRFetching, @unchecked Sendable {
    var results: [Result<MRRSummary, MRRFetchError>] = []
    private(set) var calls = 0
    func fetchMRR(config: ServerConfig) async throws -> MRRSummary {
        calls += 1
        let r = results.isEmpty ? .failure(.unreachable("no result")) : (results.count > 1 ? results.removeFirst() : results[0])
        return try r.get()
    }
}

final class FakeStreamer: EventStreaming, @unchecked Sendable {
    /// One script per connection attempt.
    var scripts: [[Result<SSEStreamEvent, Error>]] = []
    private(set) var connections = 0
    func stream(config: ServerConfig) -> AsyncThrowingStream<SSEStreamEvent, Error> {
        connections += 1
        let script = scripts.isEmpty ? [] : scripts.removeFirst()
        return AsyncThrowingStream { c in
            for step in script {
                switch step {
                case .success(let e): c.yield(e)
                case .failure(let err): c.finish(throwing: err); return
                }
            }
            c.finish()
        }
    }
}

final class FakePlayer: GongPlaying, @unchecked Sendable {
    private(set) var strikes: [Tier] = []
    func strike(tier: Tier) { strikes.append(tier) }
}

final class MemoryTokenStore: TokenStoring, @unchecked Sendable {
    var token: String?
    func readToken() -> String? { token }
    func writeToken(_ token: String?) { self.token = token }
}

func makeSummary(mrr: Int = 124_700, delta: Int = 2_900, streak: Int = 12, goalLeft: Int? = 38) -> MRRSummary {
    MRRSummary(mrrMinor: mrr, currency: "USD", formatted: "$1,247.00", todayDeltaMinor: delta, streakDays: streak,
               goalMinor: goalLeft == nil ? nil : 200_000, goalPercentLeft: goalLeft)
}

func json(_ s: MRRSummary) -> String {
    String(data: try! JSONEncoder().encode(s), encoding: .utf8)!
}
