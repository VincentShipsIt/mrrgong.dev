import Foundation

public struct SSEMessage: Equatable, Sendable {
    public var event: String?
    public var data: String
    public init(event: String?, data: String) {
        self.event = event
        self.data = data
    }
}

/// Incremental Server-Sent Events parser. Byte-based on purpose: `URLSession.AsyncBytes.lines`
/// drops blank lines, and a blank line is what dispatches an event.
public struct SSEParser {
    private var line = [UInt8]()
    private var lastWasCR = false
    private var event: String?
    private var dataLines = [String]()

    public init() {}

    public mutating func feed(_ chunk: Data) -> [SSEMessage] {
        var out = [SSEMessage]()
        for byte in chunk {
            if byte == 0x0A { // \n
                if lastWasCR { lastWasCR = false; continue } // second half of \r\n
                finishLine(&out)
            } else if byte == 0x0D { // \r
                lastWasCR = true
                finishLine(&out)
            } else {
                lastWasCR = false
                line.append(byte)
            }
        }
        return out
    }

    private mutating func finishLine(_ out: inout [SSEMessage]) {
        defer { line.removeAll(keepingCapacity: true) }
        if line.isEmpty {
            if !dataLines.isEmpty { out.append(SSEMessage(event: event, data: dataLines.joined(separator: "\n"))) }
            event = nil
            dataLines.removeAll()
            return
        }
        guard line[0] != UInt8(ascii: ":") else { return } // comment / ping
        let text = String(decoding: line, as: UTF8.self)
        let name: String, value: String
        if let colon = text.firstIndex(of: ":") {
            name = String(text[..<colon])
            var rest = text[text.index(after: colon)...]
            if rest.first == " " { rest = rest.dropFirst() }
            value = String(rest)
        } else {
            name = text
            value = ""
        }
        switch name {
        case "event": event = value
        case "data": dataLines.append(value)
        default: break // id / retry / unknown
        }
    }
}
