import Foundation

private let zeroDecimal: Set<String> = ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]
private let threeDecimal: Set<String> = ["BHD", "JOD", "KWD", "OMR", "TND"]

public enum Money {
    /// Same minor-unit table as the server's src/sale.ts.
    public static func major(minor: Int, currency: String) -> Double {
        let c = currency.uppercased()
        let digits = zeroDecimal.contains(c) ? 0 : threeDecimal.contains(c) ? 3 : 2
        return Double(minor) / pow(10, Double(digits))
    }

    private static func format(_ value: Double, currency: String, fractionDigits: Int) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: "en_US")
        f.numberStyle = .currency
        f.currencyCode = currency.uppercased()
        f.minimumFractionDigits = fractionDigits
        f.maximumFractionDigits = fractionDigits
        if let s = f.string(from: NSNumber(value: value)), currencyIsKnown(currency) { return s }
        return "\(Int(value.rounded())) \(currency.uppercased())"
    }

    private static func currencyIsKnown(_ code: String) -> Bool {
        Locale.commonISOCurrencyCodes.contains(code.uppercased())
    }

    /// "$1,247": whole units, for the menu bar and tiles.
    public static func compact(minor: Int, currency: String) -> String {
        format(major(minor: minor, currency: currency), currency: currency, fractionDigits: 0)
    }

    public static func full(major: Double, currency: String) -> String {
        format(major, currency: currency, fractionDigits: 2)
    }

    /// Reads the major-unit number out of a server-formatted amount such as "$1,234.50" or "10.00 SEK".
    public static func parseMajor(_ amount: String) -> Double? {
        let cleaned = amount.filter { $0.isNumber || $0 == "." }
        return Double(cleaned)
    }
}

public enum Formatting {
    public static func menuBarTitle(minor: Int, currency: String) -> String {
        "\(Money.compact(minor: minor, currency: currency)) MRR"
    }

    private static func signed(_ minor: Int, currency: String) -> String {
        let body = Money.compact(minor: abs(minor), currency: currency)
        if minor > 0 { return "+\(body)" }
        if minor < 0 { return "\u{2212}\(body)" }
        return body
    }

    public static func signedMRR(deltaMinor: Int, currency: String) -> String {
        "\(signed(deltaMinor, currency: currency)) MRR"
    }

    public static func todayChange(deltaMinor: Int, currency: String) -> String {
        "\(signedMRR(deltaMinor: deltaMinor, currency: currency)) today"
    }

    public static func streak(days: Int) -> String { "\(days) \(days == 1 ? "day" : "days") up" }
    public static func sales(count: Int) -> String { "\(count) \(count == 1 ? "sale" : "sales")" }
    public static func percentLeft(_ percent: Int) -> String { "\(percent)% left" }

    public static func goalCaption(goalMinor: Int, currency: String) -> String {
        "of \(Money.compact(minor: goalMinor, currency: currency)) MRR goal"
    }

    /// 0...1 progress for the thin bar, from the server's "% left".
    public static func goalProgress(percentLeft: Int) -> Double {
        min(1, max(0, 1 - Double(percentLeft) / 100))
    }

    public static func relative(_ date: Date, now: Date = Date()) -> String {
        let s = Int(now.timeIntervalSince(date))
        if s < 60 { return "just now" }
        if s < 3600 { return "\(s / 60)m ago" }
        if s < 86_400 { return "\(s / 3600)h ago" }
        return "\(s / 86_400)d ago"
    }
}
