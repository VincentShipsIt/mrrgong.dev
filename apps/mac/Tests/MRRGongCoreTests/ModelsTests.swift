import XCTest
@testable import MRRGongCore

final class ModelsTests: XCTestCase {
    func testDecodesFullSummary() throws {
        let json = #"{"mrrMinor":124700,"currency":"USD","formatted":"$1,247.00","todayDeltaMinor":2900,"streakDays":12,"goalMinor":200000,"goalPercentLeft":38}"#
        let s = try JSONDecoder().decode(MRRSummary.self, from: Data(json.utf8))
        XCTAssertEqual(s.mrrMinor, 124700)
        XCTAssertEqual(s.currency, "USD")
        XCTAssertEqual(s.todayDeltaMinor, 2900)
        XCTAssertEqual(s.streakDays, 12)
        XCTAssertEqual(s.goalMinor, 200000)
        XCTAssertEqual(s.goalPercentLeft, 38)
    }

    func testDecodesSummaryWithoutGoal() throws {
        let json = #"{"mrrMinor":500,"currency":"EUR","formatted":"€5.00","todayDeltaMinor":-100,"streakDays":0}"#
        let s = try JSONDecoder().decode(MRRSummary.self, from: Data(json.utf8))
        XCTAssertNil(s.goalMinor)
        XCTAssertNil(s.goalPercentLeft)
        XCTAssertEqual(s.todayDeltaMinor, -100)
    }

    func testDecodesSaleEvent() throws {
        let json = #"{"amount":"$240.00","tier":"big","kind":"new_subscription","label":"Ada"}"#
        let e = try JSONDecoder().decode(SaleEvent.self, from: Data(json.utf8))
        XCTAssertEqual(e.amount, "$240.00")
        XCTAssertEqual(e.tier, .big)
        XCTAssertEqual(e.kind, .newSubscription)
        XCTAssertEqual(e.label, "Ada")
    }

    func testSaleEventLabelIsOptional() throws {
        let json = #"{"amount":"$5.00","tier":"normal","kind":"one_time"}"#
        let e = try JSONDecoder().decode(SaleEvent.self, from: Data(json.utf8))
        XCTAssertNil(e.label)
        XCTAssertEqual(e.kind, .oneTime)
    }

    func testUnknownTierFallsBackToNormal() throws {
        let json = #"{"amount":"$5.00","tier":"mega","kind":"renewal"}"#
        let e = try JSONDecoder().decode(SaleEvent.self, from: Data(json.utf8))
        XCTAssertEqual(e.tier, .normal)
        XCTAssertEqual(e.kind, .renewal)
    }

    func testRejectsMalformedSale() {
        XCTAssertThrowsError(try JSONDecoder().decode(SaleEvent.self, from: Data(#"{"tier":"big"}"#.utf8)))
    }

    func testKindTitles() {
        XCTAssertEqual(SaleKind.oneTime.title, "Sale")
        XCTAssertEqual(SaleKind.newSubscription.title, "New subscription")
        XCTAssertEqual(SaleKind.renewal.title, "Renewal")
    }
}
