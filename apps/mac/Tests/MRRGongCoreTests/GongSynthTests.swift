import XCTest
@testable import MRRGongCore

final class GongSynthTests: XCTestCase {
    func testProfilesPerTier() {
        XCTAssertEqual(GongProfile.profile(for: .normal), GongProfile(baseHz: 98, decaySeconds: 4.5, strikes: 1))
        XCTAssertEqual(GongProfile.profile(for: .big), GongProfile(baseHz: 82, decaySeconds: 4.5, strikes: 2))
        XCTAssertEqual(GongProfile.profile(for: .huge), GongProfile(baseHz: 70, decaySeconds: 7, strikes: 3))
    }

    func testPartialRatios() {
        XCTAssertEqual(GongSynth.ratios, [1, 1.51, 2.03, 2.64, 3.28, 4.7, 6.1])
        XCTAssertEqual(GongSynth.strikeSpacing, 0.7)
    }

    func testDurationCoversStrikesAndTail() {
        let normal = GongSynth.duration(for: GongProfile.profile(for: .normal))
        let huge = GongSynth.duration(for: GongProfile.profile(for: .huge))
        XCTAssertGreaterThan(normal, 4.5)
        XCTAssertGreaterThan(huge, 2 * 0.7 + 7)
    }

    func testRenderIsAudibleBoundedAndFinite() {
        let samples = GongSynth.render(GongProfile.profile(for: .big), sampleRate: 8_000)
        XCTAssertEqual(samples.count, Int((GongSynth.duration(for: GongProfile.profile(for: .big)) * 8_000).rounded(.up)))
        let peak = samples.map { abs($0) }.max() ?? 0
        XCTAssertGreaterThan(peak, 0.2)
        XCTAssertLessThanOrEqual(peak, 1.0)
        XCTAssertTrue(samples.allSatisfy { $0.isFinite })
    }

    func testStartsSilentAndDecays() {
        let sr = 8_000.0
        let samples = GongSynth.render(GongProfile.profile(for: .normal), sampleRate: sr)
        func rms(_ range: Range<Int>) -> Float {
            let slice = samples[range]
            return (slice.reduce(0) { $0 + $1 * $1 } / Float(slice.count)).squareRoot()
        }
        XCTAssertEqual(samples[0], 0, accuracy: 0.001)
        let early = rms(Int(0.1 * sr)..<Int(0.6 * sr))
        let late = rms(Int(3.5 * sr)..<Int(4.0 * sr))
        XCTAssertGreaterThan(early, late * 4)
        XCTAssertGreaterThan(late, 0) // still ringing at 3.5 s
    }

    func testSecondStrikeRestrikesTheGong() {
        let sr = 8_000.0
        let one = GongSynth.render(GongProfile(baseHz: 82, decaySeconds: 4.5, strikes: 1), sampleRate: sr)
        let two = GongSynth.render(GongProfile(baseHz: 82, decaySeconds: 4.5, strikes: 2), sampleRate: sr)
        func rms(_ s: [Float], _ a: Double, _ b: Double) -> Float {
            let slice = s[Int(a * sr)..<Int(b * sr)]
            return (slice.reduce(0) { $0 + $1 * $1 } / Float(slice.count)).squareRoot()
        }
        // right after 0.7 s the second strike adds energy that a single strike does not have
        XCTAssertGreaterThan(rms(two, 0.72, 0.9), rms(one, 0.72, 0.9) * 1.05)
    }

    func testPartialsPastNyquistAreSkipped() {
        let samples = GongSynth.render(GongProfile(baseHz: 2_000, decaySeconds: 1, strikes: 1), sampleRate: 8_000)
        XCTAssertTrue(samples.allSatisfy { $0.isFinite && abs($0) <= 1 })
    }
}
