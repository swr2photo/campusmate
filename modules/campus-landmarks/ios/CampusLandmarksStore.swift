import Combine
import CryptoKit
import Foundation

/// An offline library owned by one CampusMate scope. Backend sessions remain anonymous device sessions.
@MainActor
final class CampusLandmarksStore: ObservableObject {
  @Published private(set) var landmarks: [RemoteLandmark] = []
  @Published private(set) var library = LibrarySnapshot(revision: 0, favoriteIDs: [], collections: [])
  @Published private(set) var isSyncing = false
  @Published private(set) var syncMessage: String?
  @Published private(set) var hasConflict = false
  @Published private(set) var backendURL: String
  @Published private(set) var syncEnabled: Bool

  var onLibraryChange: ((LibrarySnapshot) -> Void)?

  var nextCollectionID: Int? {
    guard library.collections.count < 100 else { return nil }
    let occupied = Set(library.collections.map(\.id))
    return (1002...1102).first { !occupied.contains($0) }
  }

  private struct Archive: Codable {
    let version: Int
    let library: LibrarySnapshot
    let hasLocalChanges: Bool
    let connectedEndpoint: String?
    let catalog: CatalogResponse?
    let catalogETag: String?
  }

  private enum Operation {
    case synchronize
    case keepLocal
    case useRemote
  }

  private let scopeHash: String
  private let storageKey: String
  private let defaults: UserDefaults
  private var hasLocalChanges = false
  private var connectedEndpoint: String?
  private var catalogCache: CatalogResponse?
  private var catalogETag: String?
  private var editGeneration: UInt64 = 0
  private var configurationGeneration: UInt64 = 0
  private var isStopped = false
  private var debounceTask: Task<Void, Never>?
  private var operationTask: Task<Void, Never>?
  private var operationID: UUID?
  private var canPersist = true
  private let isPreview = ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"

  init(scope: String, backendURL: String, syncEnabled: Bool) {
    self.backendURL = backendURL.trimmingCharacters(in: .whitespacesAndNewlines)
    self.syncEnabled = syncEnabled
    self.defaults = .standard
    self.scopeHash = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
    self.storageKey = "campusmate.landmarks.library.v1.\(scopeHash)"

    do {
      guard let url = CampusLandmarksResources.bundle.url(forResource: "catalog", withExtension: "json") else {
        throw BackendError.invalidResponse
      }
      let seed = try JSONDecoder().decode([RemoteLandmark].self, from: Data(contentsOf: url))
      try Self.validateCatalog(seed)
      landmarks = seed
    } catch {
      // A broken resource bundle must never cause a valid saved library to be discarded.
      canPersist = false
      syncMessage = "โหลดข้อมูลสถานที่เริ่มต้นไม่ได้ กรุณาติดตั้งแอปเวอร์ชันที่มีข้อมูลครบถ้วน"
      return
    }

    guard !isPreview, let data = defaults.data(forKey: storageKey) else { return }
    do {
      let archive = try JSONDecoder().decode(Archive.self, from: data)
      guard archive.version == 1 else { throw BackendError.invalidResponse }
      let restoredCatalog = archive.catalog?.landmarks ?? landmarks
      try Self.validateCatalog(restoredCatalog)
      try Self.validateLibrary(archive.library, knownIDs: Set(restoredCatalog.map(\.id)))
      landmarks = restoredCatalog
      library = archive.library
      hasLocalChanges = archive.hasLocalChanges
      connectedEndpoint = archive.connectedEndpoint
      catalogCache = archive.catalog
      catalogETag = archive.catalog == nil ? nil : archive.catalogETag
    } catch {
      // Keep the unreadable bytes under a separate scoped key before any later write.
      let recoveryKey = "\(storageKey).invalid-recovery.\(UUID().uuidString)"
      defaults.set(data, forKey: recoveryKey)
      canPersist = defaults.data(forKey: recoveryKey) == data
      syncMessage = "อ่านคลังที่บันทึกไว้ไม่ได้ เก็บสำเนาสำหรับกู้คืนแล้ว ข้อมูลเดิมจะไม่ถูกส่งไปทับเซิร์ฟเวอร์"
    }
  }

  func toggleFavorite(_ id: Int) {
    guard knownIDs.contains(id) else { return }
    var next = library
    if let index = next.favoriteIDs.firstIndex(of: id) {
      next.favoriteIDs.remove(at: index)
    } else {
      next.favoriteIDs.append(id)
    }
    commitLocal(next)
  }

  func upsertCollection(_ collection: CollectionSnapshot) {
    var next = library
    if let index = next.collections.firstIndex(where: { $0.id == collection.id }) {
      next.collections[index] = collection
    } else {
      next.collections.append(collection)
    }
    do {
      try Self.validateLibrary(next, knownIDs: knownIDs)
      commitLocal(next)
    } catch {
      syncMessage = "บันทึกคอลเลกชันไม่ได้ ใช้ชื่อไม่เกิน 120 ไบต์ คำอธิบายไม่เกิน 4,000 ไบต์ และไม่เกิน 100 คอลเลกชัน"
    }
  }

  func deleteCollection(id: Int) {
    guard library.collections.contains(where: { $0.id == id }) else { return }
    var next = library
    next.collections.removeAll { $0.id == id }
    commitLocal(next)
  }

  func setMembership(landmarkID: Int, collectionID: Int, included: Bool) {
    guard knownIDs.contains(landmarkID),
          let index = library.collections.firstIndex(where: { $0.id == collectionID }) else { return }
    var next = library
    let current = next.collections[index].landmarkIDs
    if included {
      guard !current.contains(landmarkID) else { return }
      next.collections[index].landmarkIDs.append(landmarkID)
    } else {
      guard current.contains(landmarkID) else { return }
      next.collections[index].landmarkIDs.removeAll { $0 == landmarkID }
    }
    commitLocal(next)
  }

  func configure(url: String, enabled: Bool) {
    let normalizedInput = url.trimmingCharacters(in: .whitespacesAndNewlines)
    let changed = normalizedInput != backendURL || enabled != syncEnabled
    let wasStopped = isStopped
    isStopped = false
    guard changed || wasStopped else { return }
    configurationGeneration &+= 1
    debounceTask?.cancel()
    operationTask?.cancel()
    backendURL = normalizedInput
    syncEnabled = enabled
    hasConflict = false
    syncMessage = nil
    scheduleSync()
  }

  func stop() {
    isStopped = true
    configurationGeneration &+= 1
    debounceTask?.cancel()
    debounceTask = nil
    operationTask?.cancel()
  }

  func synchronize() async {
    isStopped = false
    guard !hasConflict else { return }
    await run(.synchronize)
  }

  func resolveConflict(usingRemote: Bool) async {
    isStopped = false
    guard hasConflict else { return }
    await run(usingRemote ? .useRemote : .keepLocal)
  }

  private var knownIDs: Set<Int> { Set(landmarks.map(\.id)) }

  private func commitLocal(_ next: LibrarySnapshot) {
    guard next != library else { return }
    library = next
    editGeneration &+= 1
    hasLocalChanges = true
    if !hasConflict { syncMessage = nil }
    persist()
    onLibraryChange?(library)
    scheduleSync()
  }

  private func persist() {
    guard !isPreview, canPersist else { return }
    do {
      let data = try JSONEncoder().encode(Archive(version: 1, library: library,
        hasLocalChanges: hasLocalChanges, connectedEndpoint: connectedEndpoint,
        catalog: catalogCache, catalogETag: catalogETag))
      defaults.set(data, forKey: storageKey)
    } catch {
      syncMessage = "บันทึกการเปลี่ยนแปลงบนอุปกรณ์ไม่ได้ กรุณาลองอีกครั้ง"
    }
  }

  private func scheduleSync() {
    debounceTask?.cancel()
    guard syncEnabled, !backendURL.isEmpty, !hasConflict, !isStopped, !isPreview, canPersist else { return }
    debounceTask = Task { [weak self] in
      do { try await Task.sleep(nanoseconds: 900_000_000) }
      catch { return }
      guard let self, !Task.isCancelled else { return }
      self.debounceTask = nil
      await self.synchronize()
    }
  }

  private func run(_ operation: Operation) async {
    guard syncEnabled, !isSyncing, !isStopped, !isPreview, canPersist else { return }
    debounceTask?.cancel()
    debounceTask = nil
    isSyncing = true
    let id = UUID()
    let configuration = configurationGeneration
    let generation = editGeneration
    operationID = id
    let task = Task { [weak self] in
      guard let self else { return }
      await self.perform(operation, configuration: configuration, generation: generation)
    }
    operationTask = task
    await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
    if operationID == id {
      operationTask = nil
      operationID = nil
    }
  }

  private func perform(_ operation: Operation, configuration: UInt64, generation: UInt64) async {
    var succeeded = false
    defer {
      isSyncing = false
      if !isStopped && syncEnabled {
        if configuration != configurationGeneration || (succeeded && hasLocalChanges && generation != editGeneration) {
          scheduleSync()
        }
      }
    }

    do {
      let url = try BackendConfiguration.baseURL(from: backendURL)
      let endpoint = url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
      try checkConfiguration(configuration)
      if connectedEndpoint != endpoint {
        connectedEndpoint = endpoint
        // A revision is meaningful only for the configured server and scoped session.
        library.revision = 0
        hasLocalChanges = hasLocalChanges || !library.favoriteIDs.isEmpty || !library.collections.isEmpty
        catalogCache = nil
        catalogETag = nil
        persist()
      }

      let api = LandmarksAPI(baseURL: url)
      if case .synchronize = operation {
        let (catalog, etag) = try await api.catalog(etag: catalogCache == nil ? nil : catalogETag)
        try checkConfiguration(configuration)
        if let catalog {
          try Self.validateCatalog(catalog.landmarks)
          // A catalog update cannot silently remove a place from an existing library.
          try Self.validateLibrary(library, knownIDs: Set(catalog.landmarks.map(\.id)))
          landmarks = catalog.landmarks
          catalogCache = catalog
        }
        catalogETag = etag
        persist()
      }

      let token = try await sessionToken(api: api, endpoint: endpoint, configuration: configuration)
      let remote = try await api.library(token: token)
      try checkConfiguration(configuration)
      try Self.validateLibrary(remote, knownIDs: knownIDs)

      switch operation {
      case .useRemote:
        guard generation == editGeneration else {
          throw BackendError.server("คลังบนอุปกรณ์เปลี่ยนระหว่างซิงก์ กรุณาตรวจสอบก่อนแทนที่ข้อมูลอีกครั้ง")
        }
        // Explicit replacement keeps the complete local version in the same user scope.
        try saveRecovery()
        applyRemote(remote, dirty: false)
      case .keepLocal:
        try await saveLocal(api: api, token: token, revision: remote.revision, configuration: configuration)
      case .synchronize:
        // Edits during either catalog loading or GET are observed here, never discarded.
        if hasLocalChanges {
          guard remote.revision == library.revision else { throw BackendError.conflict }
          try await saveLocal(api: api, token: token, revision: remote.revision, configuration: configuration)
        } else {
          guard remote.revision >= library.revision,
                remote.revision != library.revision || remote == library else { throw BackendError.conflict }
          applyRemote(remote, dirty: false)
        }
      }

      hasConflict = false
      syncMessage = hasLocalChanges ? "เก็บการเปลี่ยนแปลงล่าสุดไว้แล้ว กำลังรอซิงก์" : "สถานที่ที่บันทึกไว้เป็นข้อมูลล่าสุดแล้ว"
      persist()
      succeeded = true
    } catch is CancellationError {
      // Configuration changes, leaving the screen and cancelled tasks preserve the local queue.
    } catch BackendError.conflict {
      guard configuration == configurationGeneration, !isStopped else { return }
      hasConflict = true
      syncMessage = "คลังบนเซิร์ฟเวอร์มีการเปลี่ยนแปลง เลือกเก็บข้อมูลบนอุปกรณ์หรือใช้ข้อมูลบนเซิร์ฟเวอร์"
    } catch {
      guard configuration == configurationGeneration, !isStopped, !Task.isCancelled else { return }
      syncMessage = friendlyMessage(for: error)
    }
  }

  private func saveLocal(api: LandmarksAPI, token: String, revision: Int, configuration: UInt64) async throws {
    var submitted = library
    submitted.revision = revision
    try Self.validateLibrary(submitted, knownIDs: knownIDs)
    let submittedGeneration = editGeneration
    let saved = try await api.saveLibrary(submitted, token: token)
    try checkConfiguration(configuration)
    try Self.validateLibrary(saved, knownIDs: knownIDs)
    guard revision < Int.max, saved.revision == revision + 1,
          saved.favoriteIDs == submitted.favoriteIDs, saved.collections == submitted.collections else {
      throw BackendError.invalidResponse
    }
    if submittedGeneration == editGeneration {
      applyRemote(saved, dirty: false)
    } else {
      // The server accepted the previous payload; newer edits inherit its revision and stay queued.
      library.revision = saved.revision
      hasLocalChanges = true
      onLibraryChange?(library)
    }
  }

  private func applyRemote(_ snapshot: LibrarySnapshot, dirty: Bool) {
    let changed = snapshot != library
    library = snapshot
    hasLocalChanges = dirty
    if changed { onLibraryChange?(snapshot) }
  }

  private func checkConfiguration(_ expected: UInt64) throws {
    try Task.checkCancellation()
    guard syncEnabled, !isStopped, configurationGeneration == expected else { throw CancellationError() }
  }

  private func sessionToken(api: LandmarksAPI, endpoint: String, configuration: UInt64) async throws -> String {
    let account = "campusmate.\(scopeHash)|\(endpoint)"
    if let token = try await SessionKeychain.shared.token(for: account) {
      try checkConfiguration(configuration)
      return token
    }
    try checkConfiguration(configuration)
    let token = try await api.createSession()
    try checkConfiguration(configuration)
    try await SessionKeychain.shared.save(token, for: account)
    try checkConfiguration(configuration)
    return token
  }

  private func saveRecovery() throws {
    let data = try JSONEncoder().encode(library)
    let key = "\(storageKey).recovery.v1"
    defaults.set(data, forKey: key)
    guard defaults.data(forKey: key) == data else {
      throw BackendError.server("เก็บสำเนาคลังบนอุปกรณ์ไม่ได้ จึงยังไม่แทนที่ข้อมูล")
    }
  }

  private static func validateCatalog(_ landmarks: [RemoteLandmark]) throws {
    guard !landmarks.isEmpty, landmarks.count <= 1000,
          Set(landmarks.map(\.id)).count == landmarks.count,
          landmarks.allSatisfy({
            $0.id > 0 && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              && $0.latitude.isFinite && $0.longitude.isFinite && $0.span.isFinite
              && (-90...90).contains($0.latitude) && (-180...180).contains($0.longitude)
              && $0.span > 0 && $0.span <= 180
          }) else { throw BackendError.invalidResponse }
  }

  private static func validateLibrary(_ snapshot: LibrarySnapshot, knownIDs: Set<Int>) throws {
    guard snapshot.revision >= 0, snapshot.revision < Int.max, snapshot.collections.count <= 100,
          Set(snapshot.favoriteIDs).count == snapshot.favoriteIDs.count,
          Set(snapshot.favoriteIDs).isSubset(of: knownIDs),
          Set(snapshot.collections.map(\.id)).count == snapshot.collections.count,
          snapshot.collections.allSatisfy({
            $0.id >= 1002 && !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
              && $0.name.utf8.count <= 120 && $0.description.utf8.count <= 4000
              && Set($0.landmarkIDs).count == $0.landmarkIDs.count
              && Set($0.landmarkIDs).isSubset(of: knownIDs)
          }) else { throw BackendError.invalidResponse }
  }

  private func friendlyMessage(for error: Error) -> String {
    guard let backendError = error as? BackendError else {
      return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ข้อมูลที่บันทึกไว้ยังอยู่บนอุปกรณ์ กรุณาลองอีกครั้ง"
    }
    switch backendError {
    case .invalidURL: return "ระบุ URL หลักของเซิร์ฟเวอร์ โดยไม่มีพาธ รหัสผ่าน หรือพารามิเตอร์"
    case .insecureURL: return "ใช้เซิร์ฟเวอร์ HTTPS เพื่อซิงก์ข้อมูลอย่างปลอดภัย"
    case .invalidResponse: return "ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง ข้อมูลบนอุปกรณ์ยังคงอยู่"
    case .unauthorized: return "เซสชันซิงก์ของอุปกรณ์หมดอายุ ข้อมูลบนอุปกรณ์ยังคงอยู่"
    case .conflict: return "คลังมีการเปลี่ยนแปลง กรุณาเลือกข้อมูลที่ต้องการเก็บ"
    case .server(let message): return message
    }
  }
}
