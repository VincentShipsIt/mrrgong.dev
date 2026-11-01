import MRRGongCore
import SwiftUI

/// Hero tile plus the stat grid. Shared by the popover and the desktop widget.
struct DashboardView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(spacing: 10) {
            if let summary = model.liveSummary {
                hero(summary)
                grid(summary)
            } else {
                StatusTile(status: model.status)
            }
        }
    }

    private func hero(_ s: MRRSummary) -> some View {
        Tile {
            VStack(alignment: .leading, spacing: 6) {
                TileLabel(text: "Monthly recurring revenue")
                Metric(value: Money.compact(minor: s.mrrMinor, currency: s.currency), unit: "MRR", size: 38)
                Text(Formatting.todayChange(deltaMinor: s.todayDeltaMinor, currency: s.currency))
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(s.todayDeltaMinor >= 0 ? Theme.gold : Theme.loss)
                Sparkline(values: model.sparkline)
                    .frame(height: 44)
                    .padding(.top, 4)
                Text(model.sparkline.isEmpty ? "Collecting history…" : "Last \(AppModel.sparklineDays) days")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
            }
        }
    }

    private func grid(_ s: MRRSummary) -> some View {
        let today = model.today
        var tiles: [AnyView] = [
            AnyView(Tile {
                VStack(alignment: .leading, spacing: 6) {
                    TileLabel(text: "Day streak")
                    Metric(value: "\(s.streakDays)", unit: s.streakDays == 1 ? "day up" : "days up")
                }
            }),
        ]
        if let left = s.goalPercentLeft {
            tiles.append(AnyView(Tile {
                VStack(alignment: .leading, spacing: 6) {
                    TileLabel(text: "Goal")
                    Metric(value: "\(left)%", unit: "left")
                    ProgressBar(fraction: Formatting.goalProgress(percentLeft: left))
                    if let goal = s.goalMinor {
                        Text(Formatting.goalCaption(goalMinor: goal, currency: s.currency))
                            .font(.system(size: 11))
                            .foregroundStyle(Theme.muted)
                    }
                }
            }))
        }
        tiles.append(AnyView(Tile {
            VStack(alignment: .leading, spacing: 6) {
                TileLabel(text: "Today")
                Metric(value: "\(today.count)", unit: today.count == 1 ? "sale" : "sales")
                Text("\(Money.full(major: today.totalMajor, currency: s.currency)) collected")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.muted)
            }
        }))
        tiles.append(AnyView(Tile {
            VStack(alignment: .leading, spacing: 6) {
                TileLabel(text: "This month")
                if let change = model.monthChangeMinor {
                    Metric(value: Formatting.signedMRR(deltaMinor: change, currency: s.currency).replacingOccurrences(of: " MRR", with: ""), unit: "MRR")
                } else {
                    Text("Not enough history yet").font(.system(size: 11)).foregroundStyle(Theme.muted)
                }
            }
        }))
        return VStack(spacing: 10) {
            ForEach(Array(stride(from: 0, to: tiles.count, by: 2)), id: \.self) { i in
                HStack(alignment: .top, spacing: 10) {
                    tiles[i]
                    if i + 1 < tiles.count { tiles[i + 1] }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Shown instead of numbers whenever the server is not giving us live data.
struct StatusTile: View {
    let status: ConnectionStatus

    var body: some View {
        Tile(muted: true) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: status == .connecting ? "arrow.triangle.2.circlepath" : "bell.slash.fill")
                        .foregroundStyle(Theme.muted)
                    Text(title).font(.system(size: 15, weight: .semibold, design: .rounded)).foregroundStyle(Theme.text)
                }
                Text(detail).font(.system(size: 12)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var title: String {
        switch status {
        case .unreachable: "Can't reach server"
        case .connecting: "Connecting…"
        case .unauthorized: "Token rejected"
        case .watcherOff: "Watcher is off"
        case .noDataYet: "Waiting for data"
        case .live: ""
        }
    }

    private var detail: String {
        switch status {
        case .unreachable: "Check the server URL in Settings and that mrrgong is running."
        case .connecting: "Talking to your mrrgong server."
        case .unauthorized: "The server wants a token. Add it in Settings."
        case .watcherOff: "The server is up but isn't watching Stripe for MRR."
        case .noDataYet: "The server hasn't computed MRR yet. Try again in a moment."
        case .live: ""
        }
    }
}
