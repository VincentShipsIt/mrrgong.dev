import Foundation

public struct GongProfile: Equatable, Sendable {
    public var baseHz: Double
    public var decaySeconds: Double
    public var strikes: Int

    public static func profile(for tier: Tier) -> GongProfile {
        switch tier {
        case .normal: GongProfile(baseHz: 98, decaySeconds: 4.5, strikes: 1)
        case .big: GongProfile(baseHz: 82, decaySeconds: 4.5, strikes: 2)
        case .huge: GongProfile(baseHz: 70, decaySeconds: 7, strikes: 3)
        }
    }
}

/// Additive gong: inharmonic sine partials, each ringing out exponentially. No audio files.
public enum GongSynth {
    public static let ratios: [Double] = [1, 1.51, 2.03, 2.64, 3.28, 4.7, 6.1]
    public static let strikeSpacing = 0.7
    private static let attack = 0.006

    public static func duration(for profile: GongProfile) -> Double {
        Double(profile.strikes - 1) * strikeSpacing + profile.decaySeconds * 1.1
    }

    /// Mono samples in -1...1. `decaySeconds` is the time the fundamental takes to fall by 60 dB;
    /// higher partials die faster, which is what makes it sound like metal and not an organ.
    public static func render(_ profile: GongProfile, sampleRate: Double) -> [Float] {
        let count = Int((duration(for: profile) * sampleRate).rounded(.up))
        var mix = [Double](repeating: 0, count: count)
        let nyquist = sampleRate / 2

        for strike in 0..<profile.strikes {
            let start = Int(Double(strike) * strikeSpacing * sampleRate)
            let strikeGain = pow(0.88, Double(strike))
            for (i, ratio) in ratios.enumerated() {
                let freq = profile.baseHz * ratio
                guard freq < nyquist else { continue }
                let amp = strikeGain / (1 + 0.55 * Double(i))
                let t60 = profile.decaySeconds / (1 + 0.45 * Double(i))
                let tau = t60 / log(1000) // 60 dB = factor 1000
                let omega = 2 * Double.pi * freq / sampleRate
                var n = 0
                while start + n < count {
                    let t = Double(n) / sampleRate
                    let env = exp(-t / tau)
                    if env < 1e-4 { break }
                    let ramp = min(1, t / attack)
                    mix[start + n] += amp * env * ramp * sin(omega * Double(n))
                    n += 1
                }
            }
        }

        let peak = mix.reduce(0) { max($0, abs($1)) }
        let scale = peak > 0 ? 0.85 / peak : 0
        return mix.map { Float($0 * scale) }
    }
}
