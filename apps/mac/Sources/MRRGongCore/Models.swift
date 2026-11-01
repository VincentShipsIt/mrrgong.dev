import Foundation

public enum Tier: String, Codable, Sendable {
    case normal, big, huge

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Tier(rawValue: raw) ?? .normal
    }
}

public enum SaleKind: String, Codable, Sendable {
    case oneTime = "one_time"
    case newSubscription = "new_subscription"
    case renewal

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = SaleKind(rawValue: raw) ?? .oneTime
    }

    public var title: String {
        switch self {
        case .oneTime: "Sale"
        case .newSubscription: "New subscription"
        case .renewal: "Renewal"
        }
    }
}

/// Mirrors the server's GET /mrr body and `event: mrr` payload.
public struct MRRSummary: Codable, Equatable, Sendable {
    public var mrrMinor: Int
    public var currency: String
    public var formatted: String
    public var todayDeltaMinor: Int
    public var streakDays: Int
    public var goalMinor: Int?
    public var goalPercentLeft: Int?

    public init(mrrMinor: Int, currency: String, formatted: String, todayDeltaMinor: Int, streakDays: Int, goalMinor: Int?, goalPercentLeft: Int?) {
        self.mrrMinor = mrrMinor
        self.currency = currency
        self.formatted = formatted
        self.todayDeltaMinor = todayDeltaMinor
        self.streakDays = streakDays
        self.goalMinor = goalMinor
        self.goalPercentLeft = goalPercentLeft
    }
}

/// An unnamed SSE message from /events.
public struct SaleEvent: Codable, Equatable, Sendable {
    public var amount: String
    public var tier: Tier
    public var kind: SaleKind
    public var label: String?

    public init(amount: String, tier: Tier, kind: SaleKind, label: String?) {
        self.amount = amount
        self.tier = tier
        self.kind = kind
        self.label = label
    }
}
