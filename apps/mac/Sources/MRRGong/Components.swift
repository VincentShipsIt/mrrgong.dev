import MRRGongCore
import SwiftUI

/// A Control Center-style rounded tile.
struct Tile<Content: View>: View {
    var muted = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(14)
            .background(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous).fill(Theme.tile))
            .opacity(muted ? 0.8 : 1)
    }
}

struct TileLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.muted)
            .textCase(.uppercase)
            .tracking(0.6)
    }
}

/// Number plus its unit, e.g. "12" + "days up". The unit is never optional.
struct Metric: View {
    let value: String
    let unit: String
    var size: CGFloat = 22

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(value)
                .font(.system(size: size, weight: .bold, design: .rounded))
                .foregroundStyle(Theme.text)
            Text(unit)
                .font(.system(size: size * 0.55, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.gold)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
}

struct Sparkline: View {
    let values: [Int]

    var body: some View {
        GeometryReader { geo in
            if values.count >= 2 {
                let points = Self.points(values, in: geo.size)
                ZStack {
                    Path { p in
                        p.move(to: CGPoint(x: points[0].x, y: geo.size.height))
                        points.forEach { p.addLine(to: $0) }
                        p.addLine(to: CGPoint(x: points.last!.x, y: geo.size.height))
                        p.closeSubpath()
                    }
                    .fill(LinearGradient(colors: [Theme.gold.opacity(0.35), Theme.gold.opacity(0)], startPoint: .top, endPoint: .bottom))
                    Path { p in
                        p.move(to: points[0])
                        points.dropFirst().forEach { p.addLine(to: $0) }
                    }
                    .stroke(Theme.gold, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    Circle().fill(Theme.gold).frame(width: 6, height: 6).position(points.last!)
                }
            } else {
                Path { p in
                    p.move(to: CGPoint(x: 0, y: geo.size.height / 2))
                    p.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height / 2))
                }
                .stroke(Theme.track, style: StrokeStyle(lineWidth: 2, dash: [4, 4]))
            }
        }
    }

    static func points(_ values: [Int], in size: CGSize) -> [CGPoint] {
        let lo = values.min() ?? 0, hi = values.max() ?? 0
        let span = Double(max(hi - lo, 1))
        let inset: CGFloat = 4
        return values.enumerated().map { i, v in
            CGPoint(
                x: size.width * CGFloat(i) / CGFloat(values.count - 1),
                y: inset + (size.height - inset * 2) * CGFloat(1 - Double(v - lo) / span)
            )
        }
    }
}

struct ProgressBar: View {
    /// 0...1
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.track)
                Capsule().fill(Theme.gold).frame(width: max(4, geo.size.width * fraction))
            }
        }
        .frame(height: 4)
    }
}
