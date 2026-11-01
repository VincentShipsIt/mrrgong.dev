import MRRGongCore
import SwiftUI

struct PopoverView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DashboardView(model: model)
            SalesList(sales: model.sales.recent)
        }
        .padding(12)
        .frame(width: Theme.width)
        .background(Theme.background)
        .preferredColorScheme(.dark)
    }
}

struct SalesList: View {
    let sales: [SaleRecord]
    private let visibleCount = 6

    var body: some View {
        Tile {
            VStack(alignment: .leading, spacing: 10) {
                TileLabel(text: "Recent sales")
                if sales.isEmpty {
                    Text("No sales yet. They show up here the moment they land.")
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.muted)
                } else {
                    TimelineView(.periodic(from: .now, by: 30)) { context in
                        VStack(spacing: 8) {
                            ForEach(sales.prefix(visibleCount)) { sale in
                                SaleRow(sale: sale, now: context.date)
                            }
                        }
                    }
                }
            }
        }
    }
}

struct SaleRow: View {
    let sale: SaleRecord
    let now: Date

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(sale.tier == .normal ? Theme.muted : Theme.gold)
                .frame(width: 14)
            Text(sale.amount)
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .foregroundStyle(sale.tier == .normal ? Theme.text : Theme.gold)
            Text(caption)
                .font(.system(size: 12))
                .foregroundStyle(Theme.muted)
                .lineLimit(1)
            Spacer(minLength: 4)
            Text(Formatting.relative(sale.date, now: now))
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
        }
    }

    private var caption: String {
        [sale.kind.title, sale.label].compactMap { $0 }.joined(separator: " · ")
    }

    private var icon: String {
        switch sale.tier {
        case .normal: "circle.fill"
        case .big: "sparkles"
        case .huge: "flame.fill"
        }
    }
}

/// The desktop widget: the same tiles without the sales list.
struct WidgetView: View {
    @ObservedObject var model: AppModel
    var onHide: () -> Void

    var body: some View {
        DashboardView(model: model)
            .padding(12)
            .frame(width: Theme.width)
            .background(
                RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.background)
            )
            .preferredColorScheme(.dark)
            .padding(8) // room for the window shadow
            .contextMenu {
                Button("Hide widget", action: onHide)
            }
    }
}
