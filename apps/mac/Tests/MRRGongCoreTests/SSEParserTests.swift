import XCTest
@testable import MRRGongCore

final class SSEParserTests: XCTestCase {
    private func feed(_ parser: inout SSEParser, _ text: String) -> [SSEMessage] {
        parser.feed(Data(text.utf8))
    }

    func testUnnamedMessage() {
        var p = SSEParser()
        let out = feed(&p, "data: {\"a\":1}\n\n")
        XCTAssertEqual(out, [SSEMessage(event: nil, data: "{\"a\":1}")])
    }

    func testNamedEvent() {
        var p = SSEParser()
        let out = feed(&p, "event: mrr\ndata: {}\n\n")
        XCTAssertEqual(out, [SSEMessage(event: "mrr", data: "{}")])
    }

    func testMilestoneEventAsTheServerSendsIt() {
        var p = SSEParser()
        let out = feed(&p, "event: milestone\ndata: {\"kind\":\"sales\",\"title\":\"Gong! 100 sales.\"}\n\n")
        XCTAssertEqual(out, [SSEMessage(event: "milestone", data: "{\"kind\":\"sales\",\"title\":\"Gong! 100 sales.\"}")])
    }

    func testIgnoresCommentsAndPings() {
        var p = SSEParser()
        XCTAssertEqual(feed(&p, ": connected\n\n: ping\n\n"), [])
    }

    func testMultiLineDataJoinedWithNewline() {
        var p = SSEParser()
        let out = feed(&p, "data: one\ndata: two\n\n")
        XCTAssertEqual(out.first?.data, "one\ntwo")
    }

    func testCRLFAndLoneCR() {
        var p = SSEParser()
        let out = feed(&p, "data: a\r\n\r\ndata: b\r\r")
        XCTAssertEqual(out.map(\.data), ["a", "b"])
    }

    func testChunkSplitMidLineAndMidUTF8() {
        var p = SSEParser()
        let bytes = Array("data: caf\u{e9}\n\n".utf8)
        let split = bytes.firstIndex(of: 0xC3)! + 1 // between the two bytes of é
        XCTAssertEqual(p.feed(Data(bytes[..<split])), [])
        XCTAssertEqual(p.feed(Data(bytes[split...])).first?.data, "caf\u{e9}")
    }

    func testOnlyStripsOneLeadingSpace() {
        var p = SSEParser()
        XCTAssertEqual(feed(&p, "data:  x\n\n").first?.data, " x")
        XCTAssertEqual(feed(&p, "data:y\n\n").first?.data, "y")
    }

    func testFieldWithoutColonAndUnknownFieldsIgnored() {
        var p = SSEParser()
        let out = feed(&p, "retry: 3000\nid: 7\nbogus\ndata: z\n\n")
        XCTAssertEqual(out, [SSEMessage(event: nil, data: "z")])
    }

    func testBlankLineWithoutDataDispatchesNothingAndResetsEvent() {
        var p = SSEParser()
        XCTAssertEqual(feed(&p, "event: mrr\n\n"), [])
        XCTAssertEqual(feed(&p, "data: x\n\n"), [SSEMessage(event: nil, data: "x")])
    }

    func testSeveralMessagesInOneChunk() {
        var p = SSEParser()
        let out = feed(&p, "data: 1\n\nevent: mrr\ndata: 2\n\ndata: 3\n\n")
        XCTAssertEqual(out.map(\.data), ["1", "2", "3"])
        XCTAssertEqual(out[1].event, "mrr")
    }
}
