import XCTest
@testable import MRRGongCore

final class HistoryTests: XCTestCase {
    private var tmp: URL!
    private let cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    override func setUp() {
        tmp = FileManager.default.temporaryDirectory.appendingPathComponent("mrrgong-\(UUID().uuidString)")
    }
    override func tearDown() { try? FileManager.default.removeItem(at: tmp) }

    private func date(_ s: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = TimeZone(identifier: "UTC")
        return f.date(from: s)!.addingTimeInterval(12 * 3600)
    }

    private func summary(_ mrr: Int, delta: Int = 0) -> MRRSummary {
        MRRSummary(mrrMinor: mrr, currency: "USD", formatted: "", todayDeltaMinor: delta, streakDays: 0, goalMinor: nil, goalPercentLeft: nil)
    }

    func testRecordsOnePointPerDayLastWins() {
        var h = MRRHistory(calendar: cal)
        h.record(summary(100_00), at: date("2026-11-01"))
        h.record(summary(120_00), at: date("2026-11-01"))
        XCTAssertEqual(h.points.count, 2) // + seeded yesterday? no delta -> seeded at same value
        XCTAssertEqual(h.points.last?.mrrMinor, 120_00)
        XCTAssertEqual(h.points.last?.day, "2026-11-01")
    }

    func testSeedsYesterdayFromTodayDelta() {
        var h = MRRHistory(calendar: cal)
        h.record(summary(124_700, delta: 2_900), at: date("2026-11-01"))
        XCTAssertEqual(h.points.map(\.day), ["2026-10-31", "2026-11-01"])
        XCTAssertEqual(h.points.first?.mrrMinor, 121_800)
    }

    func testDoesNotOverwriteRealYesterday() {
        var h = MRRHistory(calendar: cal)
        h.record(summary(100_000), at: date("2026-10-31"))
        h.record(summary(110_000, delta: 5_000), at: date("2026-11-01"))
        XCTAssertEqual(h.points.first(where: { $0.day == "2026-10-31" })?.mrrMinor, 100_000)
    }

    func testSparklineLast14Days() {
        var h = MRRHistory(calendar: cal)
        for d in 1...20 {
            h.record(summary(d * 100), at: date(String(format: "2026-10-%02d", d)))
        }
        let spark = h.sparkline(days: 14, now: date("2026-10-20"))
        XCTAssertEqual(spark.count, 14)
        XCTAssertEqual(spark.last, 2_000)
        XCTAssertEqual(spark.first, 700)
    }

    func testSparklineEmptyWhenTooFewPoints() {
        let h = MRRHistory(calendar: cal)
        XCTAssertTrue(h.sparkline(days: 14, now: date("2026-11-01")).isEmpty)
    }

    func testMonthChangeUsesLastPointBeforeMonth() {
        var h = MRRHistory(calendar: cal)
        h.record(summary(100_000), at: date("2026-10-30"))
        h.record(summary(103_000), at: date("2026-11-02"))
        h.record(summary(110_000), at: date("2026-11-03"))
        XCTAssertEqual(h.monthChangeMinor(now: date("2026-11-03")), 10_000)
    }

    func testMonthChangeFallsBackToFirstPointInMonth() {
        var h = MRRHistory(calendar: cal)
        h.record(summary(103_000), at: date("2026-11-02"))
        h.record(summary(110_000), at: date("2026-11-03"))
        XCTAssertEqual(h.monthChangeMinor(now: date("2026-11-03")), 7_000)
    }

    func testMonthChangeNilWhenEmpty() {
        XCTAssertNil(MRRHistory(calendar: cal).monthChangeMinor(now: date("2026-11-03")))
    }

    func testCapsStoredDays() {
        var h = MRRHistory(calendar: cal, maxPoints: 5)
        for d in 1...9 { h.record(summary(d), at: date(String(format: "2026-10-%02d", d))) }
        XCTAssertEqual(h.points.count, 5)
        XCTAssertEqual(h.points.last?.day, "2026-10-09")
    }

    func testPersistenceRoundTrip() throws {
        var h = MRRHistory(calendar: cal)
        h.record(summary(5_000, delta: 100), at: date("2026-11-01"))
        let file = tmp.appendingPathComponent("history.json")
        try h.save(to: file)
        let loaded = MRRHistory.load(from: file, calendar: cal)
        XCTAssertEqual(loaded.points, h.points)
    }

    func testLoadMissingOrCorruptFileGivesEmpty() throws {
        XCTAssertTrue(MRRHistory.load(from: tmp.appendingPathComponent("nope.json"), calendar: cal).points.isEmpty)
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let bad = tmp.appendingPathComponent("bad.json")
        try Data("not json".utf8).write(to: bad)
        XCTAssertTrue(MRRHistory.load(from: bad, calendar: cal).points.isEmpty)
    }
}
