import XCTest
@testable import MRRGongCore

final class ConfigTests: XCTestCase {
    func testDefaultServer() {
        XCTAssertEqual(ServerConfig.defaultURL, "http://localhost:8787")
    }

    func testEndpointsWithoutToken() throws {
        let c = ServerConfig(urlString: "http://localhost:8787", token: nil)
        XCTAssertEqual(try c.url(path: "mrr").absoluteString, "http://localhost:8787/mrr")
        XCTAssertEqual(try c.url(path: "events").absoluteString, "http://localhost:8787/events")
    }

    func testTrailingSlashAndWhitespaceNormalised() throws {
        let c = ServerConfig(urlString: "  https://gong.example.com/  ", token: "")
        XCTAssertEqual(try c.url(path: "mrr").absoluteString, "https://gong.example.com/mrr")
        XCTAssertEqual(try c.url(path: "gong").absoluteString, "https://gong.example.com/gong")
    }

    func testTokenIsPercentEncoded() throws {
        let c = ServerConfig(urlString: "https://x.test", token: "a b&c=d")
        let url = try c.url(path: "mrr")
        XCTAssertEqual(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "a b&c=d")
        XCTAssertFalse(url.absoluteString.contains(" "))
    }

    func testSubpathServer() throws {
        let c = ServerConfig(urlString: "https://x.test/gong-app/", token: nil)
        XCTAssertEqual(try c.url(path: "events").absoluteString, "https://x.test/gong-app/events")
    }

    func testRejectsBadURL() {
        XCTAssertThrowsError(try ServerConfig(urlString: "not a url", token: nil).url(path: "mrr"))
        XCTAssertThrowsError(try ServerConfig(urlString: "ftp://x.test", token: nil).url(path: "mrr"))
        XCTAssertThrowsError(try ServerConfig(urlString: "", token: nil).url(path: "mrr"))
    }

    func testBackoffGrowsAndCaps() {
        var b = Backoff(initial: 1, maximum: 8)
        XCTAssertEqual([b.next(), b.next(), b.next(), b.next(), b.next()], [1, 2, 4, 8, 8])
        b.reset()
        XCTAssertEqual(b.next(), 1)
    }
}
