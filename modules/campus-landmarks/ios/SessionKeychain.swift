import Foundation
import Security

/// Tokens are scoped to the server and never included in library archives or logs.
actor SessionKeychain {
    static let shared = SessionKeychain()
    private let service = "CampusMate.Landmarks.Backend.Session"

    func token(for endpoint: String) throws -> String? {
        var query = baseQuery(endpoint)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else { throw KeychainError(status: status) }
        return token
    }

    func save(_ token: String, for endpoint: String) throws {
        let query = baseQuery(endpoint)
        let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8)]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecItemNotFound {
            var item = query.merging(attributes) { _, new in new }
            #if os(iOS)
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            #endif
            let status = SecItemAdd(item as CFDictionary, nil)
            guard status == errSecSuccess else { throw KeychainError(status: status) }
        } else if update != errSecSuccess {
            throw KeychainError(status: update)
        }
    }

    private func baseQuery(_ endpoint: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: endpoint]
    }

    private struct KeychainError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? { String(localized: "The device could not access its secure sync session. Unlock the device and try again.") }
    }
}
