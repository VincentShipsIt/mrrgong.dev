import XCTest
@testable import MRRGongCore

final class SettingsTests: XCTestCase {
    private func makeSettings() -> (AppSettings, MemoryTokenStore, UserDefaults) {
        let defaults = UserDefaults(suiteName: "mrrgong-tests-\(UUID().uuidString)")!
        let tokens = MemoryTokenStore()
        return (AppSettings(defaults: defaults, tokens: tokens), tokens, defaults)
    }

    func testDefaults() {
        let (s, _, _) = makeSettings()
        XCTAssertEqual(s.serverURL, ServerConfig.defaultURL)
        XCTAssertNil(s.token)
        XCTAssertFalse(s.muted)
        XCTAssertEqual(s.config, ServerConfig(urlString: ServerConfig.defaultURL, token: nil))
    }

    func testTokenGoesToTokenStoreNotDefaults() {
        let (s, tokens, defaults) = makeSettings()
        s.token = "sekret"
        XCTAssertEqual(tokens.token, "sekret")
        XCTAssertEqual(s.token, "sekret")
        XCTAssertFalse(defaults.dictionaryRepresentation().values.contains { ($0 as? String) == "sekret" })
        s.token = ""
        XCTAssertNil(tokens.token)
    }

    func testURLAndMutePersist() {
        let (s, _, defaults) = makeSettings()
        s.serverURL = "https://gong.example.com"
        s.muted = true
        let again = AppSettings(defaults: defaults, tokens: MemoryTokenStore())
        XCTAssertEqual(again.serverURL, "https://gong.example.com")
        XCTAssertTrue(again.muted)
    }

    func testBlankURLFallsBackToDefault() {
        let (s, _, _) = makeSettings()
        s.serverURL = "   "
        XCTAssertEqual(s.serverURL, ServerConfig.defaultURL)
    }

    func testKeychainRoundTrip() throws {
        let store = KeychainTokenStore(service: "dev.mrrgong.tests.\(UUID().uuidString)")
        store.writeToken("abc")
        guard store.readToken() == "abc" else { throw XCTSkip("Keychain not available in this session") }
        store.writeToken("def")
        XCTAssertEqual(store.readToken(), "def")
        store.writeToken(nil)
        XCTAssertNil(store.readToken())
    }
}
