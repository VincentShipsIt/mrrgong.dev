import AVFoundation
import Foundation

/// Plays the synthesized gong. Not unit-tested: it needs an audio device; the sample maths is
/// covered through `GongSynth`.
public final class GongPlayer: GongPlaying {
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()
    private let format: AVAudioFormat
    private var buffers = [Tier: AVAudioPCMBuffer]()
    private var prepared = false

    public init(sampleRate: Double = 44_100) {
        format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1)!
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
    }

    public func strike(tier: Tier) {
        guard let buffer = buffer(for: tier) else { return }
        if !engine.isRunning {
            engine.prepare()
            guard (try? engine.start()) != nil else { return }
        }
        node.stop() // a new sale cuts off the previous ring
        node.scheduleBuffer(buffer, at: nil, options: .interrupts, completionHandler: nil)
        node.play()
    }

    private func buffer(for tier: Tier) -> AVAudioPCMBuffer? {
        if let cached = buffers[tier] { return cached }
        let samples = GongSynth.render(GongProfile.profile(for: tier), sampleRate: format.sampleRate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)),
              let channel = buffer.floatChannelData?[0]
        else { return nil }
        samples.withUnsafeBufferPointer { channel.update(from: $0.baseAddress!, count: samples.count) }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        buffers[tier] = buffer
        return buffer
    }
}
