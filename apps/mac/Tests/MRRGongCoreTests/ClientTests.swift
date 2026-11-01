import XCTest
@testable import MRRGongCore

final class ClientTests: XCTestCase {
    private let config = ServerConfig(urlString: "http://localhost:8787", token: "secret")

    override func tearDown() { StubURLProtocol.handler = nil }

    func testFetchDecodesSummaryAndSendsToken() async throws {
        StubURLProtocol.handler = { _ in (200, Data(json(makeSummary()).utf8)) }
        let s = try await MRRClient(session: StubURLProtocol.session()).fetchMRR(config: config)
        XCTAssertEqual(s.mrrMinor, 124_700)
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.absoluteString, "http://localhost:8787/mrr?token=secret")
    }

    func testStatusCodesMapToErrors() async {
        let client = MRRClient(session: StubURLProtocol.session())
        for (code, expected) in [(404, MRRFetchError.watcherOff), (503, .noDataYet), (401, .unauthorized), (500, .badResponse)] {
            StubURLProtocol.handler = { _ in (code, Data()) }
            do {
                _ = try await client.fetchMRR(config: config)
                XCTFail("expected \(expected)")
            } catch {
                XCTAssertEqual(error as? MRRFetchError, expected, "status \(code)")
            }
        }
    }

    func testMalformedBodyIsBadResponse() async {
        StubURLProtocol.handler = { _ in (200, Data("nope".utf8)) }
        do {
            _ = try await MRRClient(session: StubURLProtocol.session()).fetchMRR(config: config)
            XCTFail()
        } catch {
            XCTAssertEqual(error as? MRRFetchError, .badResponse)
        }
    }

    func testNetworkFailureIsUnreachable() async {
        StubURLProtocol.handler = { _ in throw URLError(.cannotConnectToHost) }
        do {
            _ = try await MRRClient(session: StubURLProtocol.session()).fetchMRR(config: config)
            XCTFail()
        } catch let MRRFetchError.unreachable(message) {
            XCTAssertFalse(message.isEmpty)
        } catch {
            XCTFail("\(error)")
        }
    }

    func testBadServerURLIsUnreachableWithMessage() async {
        do {
            _ = try await MRRClient(session: StubURLProtocol.session()).fetchMRR(config: ServerConfig(urlString: "nope", token: nil))
            XCTFail()
        } catch {
            guard case MRRFetchError.unreachable = error else { return XCTFail("\(error)") }
        }
    }

    func testSSEClientYieldsOpenThenMessages() async throws {
        let body = ": connected\n\ndata: {\"amount\":\"$5.00\",\"tier\":\"normal\",\"kind\":\"one_time\"}\n\nevent: mrr\ndata: {}\n\n"
        StubURLProtocol.handler = { _ in (200, Data(body.utf8)) }
        var seen = [SSEStreamEvent]()
        for try await e in SSEClient(session: StubURLProtocol.session()).stream(config: config) { seen.append(e) }
        XCTAssertEqual(seen.count, 3)
        XCTAssertEqual(seen[0], .open)
        guard case .message(let first) = seen[1] else { return XCTFail() }
        XCTAssertNil(first.event)
        XCTAssertEqual(StubURLProtocol.lastRequest?.url?.path, "/events")
        XCTAssertEqual(StubURLProtocol.lastRequest?.value(forHTTPHeaderField: "Accept"), "text/event-stream")
    }

    func testSSEClientThrowsUnauthorizedOn401() async {
        StubURLProtocol.handler = { _ in (401, Data()) }
        do {
            for try await _ in SSEClient(session: StubURLProtocol.session()).stream(config: config) {}
            XCTFail()
        } catch {
            XCTAssertEqual(error as? MRRFetchError, .unauthorized)
        }
    }
}
