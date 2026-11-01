import MRRGongCore
import SwiftUI

struct SettingsView: View {
    let settings: AppSettings
    var onSave: () -> Void
    var onClose: () -> Void

    @State private var url: String
    @State private var token: String

    init(settings: AppSettings, onSave: @escaping () -> Void, onClose: @escaping () -> Void) {
        self.settings = settings
        self.onSave = onSave
        self.onClose = onClose
        _url = State(initialValue: settings.serverURL)
        _token = State(initialValue: settings.token ?? "")
    }

    var body: some View {
        Form {
            TextField("Server URL", text: $url, prompt: Text(ServerConfig.defaultURL))
            SecureField("Token", text: $token, prompt: Text("Optional"))
            Text("The token is stored in your Keychain. It is sent as ?token= on every request.")
                .font(.caption)
                .foregroundStyle(.secondary)
            HStack {
                Spacer()
                Button("Cancel", action: onClose).keyboardShortcut(.cancelAction)
                Button("Save") {
                    settings.serverURL = url
                    settings.token = token
                    onSave()
                    onClose()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding(.top, 6)
        }
        .formStyle(.grouped)
        .frame(width: 420)
        .fixedSize(horizontal: false, vertical: true)
    }
}
