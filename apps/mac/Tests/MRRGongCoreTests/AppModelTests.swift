import XCTest
@testable import MRRGongCore

@MainActor
final class AppModelTests: XCTestCase {
    private var dir: URL!
    private let t0 = Date(timeIntervalSince1970: 1_793_534_400) // 2026-11-01 12:00 UTC
    private var fetcher: FakeFetcher!
    private var streamer: FakeStreamer!
    private var player: FakePlayer!
    private var settings: AppSettings!

    override func setUp() {
        dir = FileManager.default.temporaryDirectory.appendingPathComponent("mrrgong-model-\(UUID().uuidString)")
        fetcher = FakeFetcher()
        streamer = FakeStreamer()
        player = FakePlayer()
        settings = AppSettings(defaults: UserDefaults(suiteName: "mrrgong-model-\(UUID().uuidString)")!, tokens: MemoryTokenStore())
    }
    override func tearDown() { try? FileManager.default.removeItem(at: dir) }

    private func makeModel(sleep: @escaping @Sendable (Double) async -> Void = { _ in try? await Task.sleep(nanoseconds: 5_000_000_000) }) -> AppModel {
        AppModel(settings: settings, fetcher: fetcher, streamer: streamer, player: player, storageDirectory: dir,
                 now: { [t0] in t0 }, sleep: sleep)
    }

    private func saleMessage(tier: String = "big") -> SSEStreamEvent {
        .message(SSEMessage(event: nil, data: #"{"amount":"$240.00","tier":"\#(tier)","kind":"new_subscription","label":"Ada"}"#))
    }

    func testRefreshSuccessGoesLiveAndRecordsHistory() async {
        fetcher.results = [.success(makeSummary())]
        let m = makeModel()
        await m.refresh()
        XCTAssertEqual(m.status, .live)
        XCTAssertEqual(m.liveSummary?.mrrMinor, 124_700)
        XCTAssertEqual(m.menuBarTitle, "$1,247 MRR")
        XCTAssertEqual(m.history.points.count, 2) // today + seeded yesterday
        XCTAssertEqual(m.sparkline.count, 2)
    }

    func testRefreshErrorsMapToStatusAndHideNumbers() async {
        let cases: [(MRRFetchError, ConnectionStatus)] = [
            (.watcherOff, .watcherOff), (.noDataYet, .noDataYet), (.unauthorized, .unauthorized),
            (.unreachable("x"), .unreachable), (.badResponse, .unreachable),
        ]
        for (error, status) in cases {
            fetcher.results = [.success(makeSummary()), .failure(error)]
            let m = makeModel()
            await m.refresh()
            XCTAssertEqual(m.status, .live)
            await m.refresh()
            XCTAssertEqual(m.status, status, "\(error)")
            XCTAssertNil(m.liveSummary, "stale numbers must be hidden for \(error)")
        }
    }

    func testMenuBarTitleWhenNotLive() async {
        fetcher.results = [.failure(.unreachable("down"))]
        let m = makeModel()
        XCTAssertEqual(m.menuBarTitle, "Connecting…")
        await m.refresh()
        XCTAssertEqual(m.menuBarTitle, "Offline")
    }

    func testSaleEventLogsStrikesAndFlashes() async {
        let m = makeModel()
        let before = m.flashCount
        m.handle(saleMessage())
        XCTAssertEqual(m.sales.recent.count, 1)
        XCTAssertEqual(m.sales.recent[0].label, "Ada")
        XCTAssertEqual(player.strikes, [.big])
        XCTAssertEqual(m.flashCount, before + 1)
        XCTAssertEqual(m.today.count, 1)
        XCTAssertEqual(m.today.totalMajor, 240, accuracy: 0.001)
    }

    func testMutedSaleStillLogsAndFlashesButIsSilent() {
        settings.muted = true
        let m = makeModel()
        m.handle(saleMessage(tier: "huge"))
        XCTAssertTrue(player.strikes.isEmpty)
        XCTAssertEqual(m.sales.recent.count, 1)
        XCTAssertEqual(m.flashCount, 1)
    }

    func testMRREventUpdatesSummary() {
        let m = makeModel()
        m.handle(.message(SSEMessage(event: "mrr", data: json(makeSummary(mrr: 150_000)))))
        XCTAssertEqual(m.status, .live)
        XCTAssertEqual(m.liveSummary?.mrrMinor, 150_000)
    }

    func testGarbageAndUnknownEventsAreIgnored() {
        let m = makeModel()
        m.handle(.message(SSEMessage(event: nil, data: "not json")))
        m.handle(.message(SSEMessage(event: "mrr", data: "{}")))
        m.handle(.message(SSEMessage(event: "other", data: "{}")))
        m.handle(.open)
        XCTAssertTrue(m.sales.recent.isEmpty)
        XCTAssertNil(m.liveSummary)
        XCTAssertTrue(player.strikes.isEmpty)
    }

    func testStrikeTestRespectsMute() {
        let m = makeModel()
        m.strikeTest()
        XCTAssertEqual(player.strikes, [.normal])
        XCTAssertEqual(m.flashCount, 1)
        m.toggleMute()
        XCTAssertTrue(m.isMuted)
        m.strikeTest()
        XCTAssertEqual(player.strikes, [.normal])
        XCTAssertEqual(m.flashCount, 2)
        XCTAssertTrue(settings.muted)
    }

    func testMonthTileUsesHistory() async {
        fetcher.results = [.success(makeSummary(mrr: 124_700, delta: 2_900))]
        let m = makeModel()
        await m.refresh()
        XCTAssertEqual(m.monthChangeMinor, 2_900) // seeded yesterday (Oct 31) is the baseline
    }

    func testStreamReconnectsWithBackoffAndSavesState() async {
        streamer.scripts = [
            [.failure(URLError(.networkConnectionLost))],
            [.failure(URLError(.networkConnectionLost))],
            [.success(.open), .success(saleMessage())],
        ]
        fetcher.results = [.failure(.unreachable("down"))]
        let delays = DelayLog()
        var model: AppModel!
        model = makeModel(sleep: { d in
            await delays.add(d)
            if await delays.count >= 3 { await MainActor.run { model.stop() } }
        })
        await model.runStreamLoop()
        let recorded = await delays.values
        XCTAssertEqual(Array(recorded.prefix(2)), [1, 2])
        XCTAssertEqual(streamer.connections, 3)
        XCTAssertEqual(model.sales.recent.count, 1)
        XCTAssertEqual(model.status, .unreachable) // SSE failure while polling is also down
        // persisted for next launch
        let reloaded = SalesLog.load(from: dir.appendingPathComponent("sales.json"))
        XCTAssertEqual(reloaded.recent.count, 1)
    }

    func testOpenAfterOutageTriggersRefresh() async {
        fetcher.results = [.failure(.unreachable("down")), .success(makeSummary())]
        streamer.scripts = [[.success(.open)]]
        var model: AppModel!
        model = makeModel(sleep: { _ in await MainActor.run { model.stop() } })
        await model.refresh()
        XCTAssertEqual(model.status, .unreachable)
        await model.runStreamLoop()
        XCTAssertEqual(model.status, .live)
    }

    func testUnauthorizedStreamSetsStatus() async {
        streamer.scripts = [[.failure(MRRFetchError.unauthorized)]]
        var model: AppModel!
        model = makeModel(sleep: { _ in await MainActor.run { model.stop() } })
        await model.runStreamLoop()
        XCTAssertEqual(model.status, .unauthorized)
    }

    func testStateSurvivesRestart() async {
        fetcher.results = [.success(makeSummary())]
        let m = makeModel()
        await m.refresh()
        m.handle(saleMessage())
        let m2 = makeModel()
        XCTAssertEqual(m2.history.points.count, 2)
        XCTAssertEqual(m2.sales.recent.count, 1)
        XCTAssertEqual(m2.status, .connecting) // numbers stay hidden until the server answers
    }
}

actor DelayLog {
    private(set) var values = [Double]()
    var count: Int { values.count }
    func add(_ d: Double) { values.append(d) }
}
