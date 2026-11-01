import SwiftUI

enum Theme {
    static let gold = Color(hex: 0xF5B301)
    static let background = Color(hex: 0x14110B)
    static let tile = Color(hex: 0x251F14)
    static let text = Color(hex: 0xF4EBD8)
    static let muted = Color(hex: 0x9C927C)
    static let loss = Color(hex: 0xE5735C)
    static let track = Color(hex: 0x3A3220)

    static let tileRadius: CGFloat = 16
    static let width: CGFloat = 320
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
