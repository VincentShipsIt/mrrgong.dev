import XCTest
@testable import MRRGongCore

final class FormattingTests: XCTestCase {
    func testCompactMoneyDropsCents() {
        XCTAssertEqual(Money.compact(minor: 124_700, currency: "USD"), "$1,247")
        XCTAssertEqual(Money.compact(minor: 0, currency: "USD"), "$0")
        XCTAssertEqual(Money.compact(minor: 2_950, currency: "USD"), "$30") // rounds
    }

    func testZeroDecimalCurrency() {
        XCTAssertEqual(Money.major(minor: 5000, currency: "JPY"), 5000)
        XCTAssertEqual(Money.major(minor: 5000, currency: "usd"), 50)
        XCTAssertEqual(Money.major(minor: 5000, currency: "KWD"), 5)
    }

    func testFullMoneyKeepsCents() {
        XCTAssertEqual(Money.full(major: 240, currency: "USD"), "$240.00")
    }

    func testUnknownCurrencyFallsBackToCode() {
        XCTAssertTrue(Money.compact(minor: 1000, currency: "???").contains("10"))
    }

    func testMenuBarTitle() {
        XCTAssertEqual(Formatting.menuBarTitle(minor: 124_700, currency: "USD"), "$1,247 MRR")
    }

    func testSignedDelta() {
        XCTAssertEqual(Formatting.todayChange(deltaMinor: 2900, currency: "USD"), "+$29 MRR today")
        XCTAssertEqual(Formatting.todayChange(deltaMinor: -1500, currency: "USD"), "−$15 MRR today")
        XCTAssertEqual(Formatting.todayChange(deltaMinor: 0, currency: "USD"), "$0 MRR today")
    }

    func testSignedMonthChange() {
        XCTAssertEqual(Formatting.signedMRR(deltaMinor: 31_000, currency: "USD"), "+$310 MRR")
        XCTAssertEqual(Formatting.signedMRR(deltaMinor: -100, currency: "USD"), "−$1 MRR")
    }

    func testStreakLabel() {
        XCTAssertEqual(Formatting.streak(days: 12), "12 days up")
        XCTAssertEqual(Formatting.streak(days: 1), "1 day up")
        XCTAssertEqual(Formatting.streak(days: 0), "0 days up")
    }

    func testSalesCount() {
        XCTAssertEqual(Formatting.sales(count: 1), "1 sale")
        XCTAssertEqual(Formatting.sales(count: 3), "3 sales")
        XCTAssertEqual(Formatting.sales(count: 0), "0 sales")
    }

    func testGoalLabels() {
        XCTAssertEqual(Formatting.percentLeft(38), "38% left")
        XCTAssertEqual(Formatting.goalCaption(goalMinor: 200_000, currency: "USD"), "of $2,000 MRR goal")
        XCTAssertEqual(Formatting.goalProgress(percentLeft: 38), 0.62, accuracy: 0.0001)
        XCTAssertEqual(Formatting.goalProgress(percentLeft: 150), 0)
        XCTAssertEqual(Formatting.goalProgress(percentLeft: -5), 1)
    }

    func testParseAmount() {
        XCTAssertEqual(Money.parseMajor("$240.00"), 240)
        XCTAssertEqual(Money.parseMajor("$1,234.50"), 1234.5)
        XCTAssertEqual(Money.parseMajor("¥5,000"), 5000)
        XCTAssertEqual(Money.parseMajor("10.00 SEK"), 10)
        XCTAssertNil(Money.parseMajor("free"))
    }

    func testRelativeTime() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-5), now: now), "just now")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-90), now: now), "1m ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-3 * 3600), now: now), "3h ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(-2 * 86_400), now: now), "2d ago")
        XCTAssertEqual(Formatting.relative(now.addingTimeInterval(30), now: now), "just now")
    }
}
