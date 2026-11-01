import XCTest
@testable import MRRGongCore

final class SalesLogTests: XCTestCase {
    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()
    private let t0 = Date(timeIntervalSince1970: 1_793_534_400) // 2026-11-01 12:00 UTC

    private func sale(_ amount: String, kind: SaleKind = .oneTime) -> SaleEvent {
        SaleEvent(amount: amount, tier: .normal, kind: kind, label: nil)
    }

    func testNewestFirstAndCapped() {
        var log = SalesLog(calendar: cal, capacity: 3)
        for i in 1...5 { log.add(sale("$\(i).00"), at: t0.addingTimeInterval(Double(i))) }
        XCTAssertEqual(log.recent.map(\.amount), ["$5.00", "$4.00", "$3.00"])
    }

    func testTodayTotals() {
        var log = SalesLog(calendar: cal)
        log.add(sale("$240.00"), at: t0)
        log.add(sale("$9.50"), at: t0.addingTimeInterval(60))
        log.add(sale("$100.00"), at: t0.addingTimeInterval(-86_400)) // yesterday
        let today = log.today(now: t0.addingTimeInterval(120))
        XCTAssertEqual(today.count, 2)
        XCTAssertEqual(today.totalMajor, 249.5, accuracy: 0.001)
    }

    func testRefundsAndCancellationsAreLoggedButNotCountedAsSalesToday() {
        var log = SalesLog(calendar: cal)
        log.add(sale("$240.00"), at: t0)
        log.add(sale("$49.00", kind: .refund), at: t0.addingTimeInterval(30))
        log.add(sale("$29.00", kind: .cancellation), at: t0.addingTimeInterval(60))
        XCTAssertEqual(log.recent.count, 3)
        let today = log.today(now: t0.addingTimeInterval(120))
        XCTAssertEqual(today.count, 1)
        XCTAssertEqual(today.totalMajor, 240, accuracy: 0.001)
    }

    func testUnparseableAmountCountsAsSaleButNotMoney() {
        var log = SalesLog(calendar: cal)
        log.add(sale("free"), at: t0)
        let today = log.today(now: t0)
        XCTAssertEqual(today.count, 1)
        XCTAssertEqual(today.totalMajor, 0)
    }

    func testPersistenceRoundTripKeepsDates() throws {
        var log = SalesLog(calendar: cal)
        log.add(SaleEvent(amount: "$5.00", tier: .huge, kind: .renewal, label: "Ada"), at: t0)
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("sales-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: file) }
        try log.save(to: file)
        let loaded = SalesLog.load(from: file, calendar: cal)
        XCTAssertEqual(loaded.recent.count, 1)
        XCTAssertEqual(loaded.recent[0].label, "Ada")
        XCTAssertEqual(loaded.recent[0].kind, .renewal)
        XCTAssertEqual(loaded.recent[0].tier, .huge)
        XCTAssertEqual(loaded.recent[0].date.timeIntervalSince1970, t0.timeIntervalSince1970, accuracy: 1)
    }

    func testLoadCorruptGivesEmpty() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("sales-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: file) }
        try Data("{".utf8).write(to: file)
        XCTAssertTrue(SalesLog.load(from: file, calendar: cal).recent.isEmpty)
    }
}
