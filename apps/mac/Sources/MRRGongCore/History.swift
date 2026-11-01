import Foundation

public struct HistoryPoint: Codable, Equatable, Sendable {
    /// `yyyy-MM-dd`, UTC like the server's own snapshots.
    public var day: String
    public var mrrMinor: Int
}

public struct MRRHistory: Sendable {
    public private(set) var points: [HistoryPoint] = []
    private let calendar: Calendar
    private let maxPoints: Int

    public init(calendar: Calendar = MRRHistory.utcCalendar, maxPoints: Int = 400) {
        self.calendar = calendar
        self.maxPoints = maxPoints
    }

    public static let utcCalendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    private func key(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// One point per day, the last reading wins. The first reading also seeds yesterday from the
    /// server's own "today's change", so the sparkline has a slope on day one.
    public mutating func record(_ summary: MRRSummary, at date: Date) {
        let today = key(date)
        let yesterday = key(calendar.date(byAdding: .day, value: -1, to: date) ?? date)
        if !points.contains(where: { $0.day == yesterday }) {
            upsert(HistoryPoint(day: yesterday, mrrMinor: summary.mrrMinor - summary.todayDeltaMinor))
        }
        upsert(HistoryPoint(day: today, mrrMinor: summary.mrrMinor))
        if points.count > maxPoints { points.removeFirst(points.count - maxPoints) }
    }

    private mutating func upsert(_ point: HistoryPoint) {
        if let i = points.firstIndex(where: { $0.day == point.day }) {
            points[i] = point
        } else {
            points.append(point)
            points.sort { $0.day < $1.day }
        }
    }

    /// MRR values for the last `days` days; empty when there is nothing to draw yet.
    public func sparkline(days: Int, now: Date) -> [Int] {
        let from = key(calendar.date(byAdding: .day, value: -(days - 1), to: now) ?? now)
        let values = points.filter { $0.day >= from && $0.day <= key(now) }.map(\.mrrMinor)
        return values.count >= 2 ? values : []
    }

    /// Change in MRR since the end of last month (or since the first reading this month).
    public func monthChangeMinor(now: Date) -> Int? {
        guard let latest = points.last else { return nil }
        let today = key(now)
        let monthStart = String(today.prefix(8)) + "01"
        let baseline = points.last(where: { $0.day < monthStart }) ?? points.first(where: { $0.day >= monthStart })
        guard let baseline else { return nil }
        return latest.mrrMinor - baseline.mrrMinor
    }

    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(points).write(to: url, options: .atomic)
    }

    public static func load(from url: URL, calendar: Calendar = MRRHistory.utcCalendar) -> MRRHistory {
        var h = MRRHistory(calendar: calendar)
        if let data = try? Data(contentsOf: url), let pts = try? JSONDecoder().decode([HistoryPoint].self, from: data) {
            h.points = pts.sorted { $0.day < $1.day }
        }
        return h
    }
}
