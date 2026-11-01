import Foundation

public protocol GongPlaying {
    func strike(tier: Tier)
}

public enum ConnectionStatus: Equatable, Sendable {
    case connecting, live, watcherOff, noDataYet, unauthorized, unreachable
}

/// Single source of truth for the popover, menu bar title and desktop widget.
@MainActor
public final class AppModel: ObservableObject {
    @Published public private(set) var status: ConnectionStatus = .connecting
    /// Only set while `status == .live`: stale numbers are never shown.
    @Published public private(set) var liveSummary: MRRSummary?
    @Published public private(set) var history: MRRHistory
    @Published public private(set) var sales: SalesLog
    @Published public private(set) var isMuted: Bool
    /// Bumped on every strike so the status item can flash.
    @Published public private(set) var flashCount = 0

    public static let pollInterval: Double = 60
    public static let sparklineDays = 14

    private let settings: AppSettings
    private let fetcher: MRRFetching
    private let streamer: EventStreaming
    private let player: GongPlaying
    private let historyURL: URL
    private let salesURL: URL
    private let now: () -> Date
    private let sleep: (Double) async -> Void
    private var stopped = false
    private var pollTask: Task<Void, Never>?
    private var streamTask: Task<Void, Never>?

    public nonisolated static var defaultStorageDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("mrrgong")
    }

    public init(
        settings: AppSettings,
        fetcher: MRRFetching,
        streamer: EventStreaming,
        player: GongPlaying,
        storageDirectory: URL = AppModel.defaultStorageDirectory,
        now: @escaping () -> Date = Date.init,
        sleep: @escaping (Double) async -> Void = { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
    ) {
        self.settings = settings
        self.fetcher = fetcher
        self.streamer = streamer
        self.player = player
        self.now = now
        self.sleep = sleep
        historyURL = storageDirectory.appendingPathComponent("history.json")
        salesURL = storageDirectory.appendingPathComponent("sales.json")
        history = MRRHistory.load(from: historyURL)
        sales = SalesLog.load(from: salesURL)
        isMuted = settings.muted
    }

    // MARK: Derived values

    public var config: ServerConfig { settings.config }

    public var menuBarTitle: String {
        switch status {
        case .live:
            guard let s = liveSummary else { return "Connecting…" }
            return Formatting.menuBarTitle(minor: s.mrrMinor, currency: s.currency)
        case .connecting: return "Connecting…"
        case .unreachable: return "Offline"
        case .unauthorized: return "Unauthorized"
        case .watcherOff: return "Watcher off"
        case .noDataYet: return "No data yet"
        }
    }

    public var sparkline: [Int] { history.sparkline(days: Self.sparklineDays, now: now()) }
    public var today: (count: Int, totalMajor: Double) { sales.today(now: now()) }
    public var monthChangeMinor: Int? { history.monthChangeMinor(now: now()) }

    // MARK: Lifecycle

    public func start() {
        stopped = false
        pollTask?.cancel()
        streamTask?.cancel()
        pollTask = Task { await runPollLoop() }
        streamTask = Task { await runStreamLoop() }
    }

    public func stop() {
        stopped = true
        pollTask?.cancel()
        streamTask?.cancel()
    }

    /// Re-read settings (URL or token changed) and reconnect from scratch.
    public func restart() {
        stop()
        status = .connecting
        liveSummary = nil
        start()
    }

    // MARK: Polling and streaming

    public func refresh() async {
        do {
            apply(try await fetcher.fetchMRR(config: settings.config))
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            fail(error as? MRRFetchError ?? .unreachable(error.localizedDescription))
        }
    }

    public func runPollLoop() async {
        while !stopped, !Task.isCancelled {
            await refresh()
            await sleep(Self.pollInterval)
        }
    }

    public func runStreamLoop() async {
        var backoff = Backoff()
        while !stopped, !Task.isCancelled {
            do {
                for try await event in streamer.stream(config: settings.config) {
                    if case .open = event {
                        backoff.reset()
                        if status != .live { await refresh() }
                    }
                    handle(event)
                }
            } catch let error as MRRFetchError {
                fail(error)
            } catch {
                if Task.isCancelled { break }
                await refresh() // find out whether the server is down or only the stream dropped
            }
            if stopped || Task.isCancelled { break }
            await sleep(backoff.next())
        }
    }

    // MARK: Events

    public func handle(_ event: SSEStreamEvent) {
        guard case .message(let message) = event else { return }
        let data = Data(message.data.utf8)
        switch message.event {
        case nil, "message":
            if let sale = try? JSONDecoder().decode(SaleEvent.self, from: data) { record(sale) }
        case "mrr":
            if let summary = try? JSONDecoder().decode(MRRSummary.self, from: data) { apply(summary) }
        default:
            break
        }
    }

    public func strikeTest() { strike(.normal) }

    public func toggleMute() {
        settings.muted.toggle()
        isMuted = settings.muted
    }

    private func record(_ sale: SaleEvent) {
        sales.add(sale, at: now())
        try? sales.save(to: salesURL)
        if !sale.kind.isSad { strike(sale.tier) }
    }

    private func strike(_ tier: Tier) {
        flashCount += 1
        if !isMuted { player.strike(tier: tier) }
    }

    private func apply(_ summary: MRRSummary) {
        liveSummary = summary
        status = .live
        history.record(summary, at: now())
        try? history.save(to: historyURL)
    }

    private func fail(_ error: MRRFetchError) {
        liveSummary = nil
        switch error {
        case .watcherOff: status = .watcherOff
        case .noDataYet: status = .noDataYet
        case .unauthorized: status = .unauthorized
        case .badResponse, .unreachable: status = .unreachable
        }
    }
}
