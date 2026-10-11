import Foundation

struct CatalogResponse: Codable, Sendable {
    let landmarks: [RemoteLandmark]
    let revision: String
}

struct RemoteLandmark: Codable, Sendable, Identifiable {
    let id: Int
    let name: String
    let description: String
    let continent: String
    let latitude: Double
    let longitude: Double
    let span: Double
    let location: String?
    let placeID: String?

    enum CodingKeys: String, CodingKey {
        case id, name, description, continent, latitude, longitude, span, location
        case placeID = "place_id"
    }
}

struct LibrarySnapshot: Codable, Equatable, Sendable {
    var revision: Int
    var favoriteIDs: [Int]
    var collections: [CollectionSnapshot]

    enum CodingKeys: String, CodingKey {
        case revision, collections
        case favoriteIDs = "favorite_ids"
    }
}

struct CollectionSnapshot: Codable, Equatable, Sendable {
    var id: Int
    var name: String
    var description: String
    var landmarkIDs: [Int]

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case landmarkIDs = "landmark_ids"
    }
}

enum BackendError: LocalizedError {
    case invalidURL, insecureURL, invalidResponse, unauthorized, conflict
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: String(localized: "Enter the server's base URL, without a path, password, or query.")
        case .insecureURL: String(localized: "Use an HTTPS server URL. Debug builds also support http://localhost for the simulator.")
        case .invalidResponse: String(localized: "The server returned an unexpected response. Your saved places are still on this device.")
        case .unauthorized: String(localized: "This device's sync session is no longer valid. Your saved places remain on this device.")
        case .conflict: String(localized: "The server has a newer library. Choose which version to keep in Cloud Sync.")
        case .server(let message): message
        }
    }
}

enum BackendConfiguration {
    static func baseURL(from value: String) throws -> URL {
        guard var components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = components.scheme?.lowercased(),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/" else { throw BackendError.invalidURL }
        if scheme != "https" {
            #if DEBUG
            guard scheme == "http", host.lowercased() == "localhost" else { throw BackendError.insecureURL }
            #else
            throw BackendError.insecureURL
            #endif
        }
        components.scheme = scheme
        components.host = host.lowercased()
        components.path = ""
        if (scheme == "https" && components.port == 443) || (scheme == "http" && components.port == 80) {
            components.port = nil
        }
        guard let url = components.url else { throw BackendError.invalidURL }
        return url
    }
}

/// Reject redirects so that a bearer token never leaves the configured origin.
private final class RedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

actor LandmarksAPI {
    private let baseURL: URL
    private let session: URLSession

    init(baseURL: URL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.httpMaximumConnectionsPerHost = 4
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        session = URLSession(configuration: configuration, delegate: RedirectPolicy(), delegateQueue: nil)
    }

    func catalog(etag: String?) async throws -> (CatalogResponse?, String?) {
        var request = makeRequest(path: "v1/landmarks")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BackendError.invalidResponse }
        if http.statusCode == 304 { return (nil, etag) }
        try check(http, data: data)
        return (try JSONDecoder().decode(CatalogResponse.self, from: data), http.value(forHTTPHeaderField: "ETag"))
    }

    func createSession() async throws -> String {
        struct SessionResponse: Decodable { let token: String }
        let result: SessionResponse = try await send(makeRequest(path: "v1/sessions", method: "POST"))
        guard !result.token.isEmpty else { throw BackendError.invalidResponse }
        return result.token
    }

    func library(token: String) async throws -> LibrarySnapshot {
        try await send(makeRequest(path: "v1/me/library", token: token))
    }

    func saveLibrary(_ library: LibrarySnapshot, token: String) async throws -> LibrarySnapshot {
        var request = makeRequest(path: "v1/me/library", method: "PUT", token: token)
        request.httpBody = try JSONEncoder().encode(library)
        guard (request.httpBody?.count ?? 0) <= 65_536 else {
            throw BackendError.server(String(localized: "This library is too large to sync. Shorten collection descriptions or reduce the number of collections."))
        }
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return try await send(request)
    }

    private func makeRequest(path: String, method: String = "GET", token: String? = nil) -> URLRequest {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw BackendError.invalidResponse }
        try check(http, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func check(_ response: HTTPURLResponse, data: Data) throws {
        guard data.count <= 2_000_000 else { throw BackendError.invalidResponse }
        switch response.statusCode {
        case 200...299: return
        case 401: throw BackendError.unauthorized
        case 409: throw BackendError.conflict
        default:
            struct ErrorBody: Decodable {
                struct Detail: Decodable { let message: String }
                let error: Detail
            }
            let detail = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw BackendError.server(detail?.error.message ?? String(localized: "Sync is unavailable (\(response.statusCode)). Please try again."))
        }
    }
}
