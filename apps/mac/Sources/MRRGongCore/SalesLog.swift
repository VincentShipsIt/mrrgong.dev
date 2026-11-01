import Foundation

public struct SaleRecord: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var date: Date
    public var amount: String
    public var tier: Tier
    public var kind: SaleKind
    public var label: String?
}

public struct SalesLog: Sendable {
    public private(set) var recent: [SaleRecord] = []
    private let calendar: Calendar
    private let capacity: Int

    public init(calendar: Calendar = .current, capacity: Int = 50) {
        self.calendar = calendar
        self.capacity = capacity
    }

    @discardableResult
    public mutating func add(_ sale: SaleEvent, at date: Date) -> SaleRecord {
        let record = SaleRecord(id: UUID(), date: date, amount: sale.amount, tier: sale.tier, kind: sale.kind, label: sale.label)
        recent.insert(record, at: 0)
        if recent.count > capacity { recent.removeLast(recent.count - capacity) }
        return record
    }

    public func today(now: Date) -> (count: Int, totalMajor: Double) {
        let todays = recent.filter { calendar.isDate($0.date, inSameDayAs: now) }
        return (todays.count, todays.reduce(0) { $0 + (Money.parseMajor($1.amount) ?? 0) })
    }

    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        try enc.encode(recent).write(to: url, options: .atomic)
    }

    public static func load(from url: URL, calendar: Calendar = .current) -> SalesLog {
        var log = SalesLog(calendar: calendar)
        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        if let data = try? Data(contentsOf: url), let recs = try? dec.decode([SaleRecord].self, from: data) {
            log.recent = Array(recs.prefix(log.capacity))
        }
        return log
    }
}
