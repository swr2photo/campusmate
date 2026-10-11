import ExpoModulesCore
import ExpoUI
import MapKit
import SwiftUI

final class CampusLandmarksProps: UIBaseViewProps {
  @Field var title: String = "สถานที่"
  @Field var storageScope: String = "device"
  @Field var backendURL: String = ""
  @Field var syncEnabled: Bool = false
  var onClose = EventDispatcher()
  var onSelectPlace = EventDispatcher()
  var onLibraryChange = EventDispatcher()
}

struct CampusLandmarksView: ExpoSwiftUI.View {
  @ObservedObject var props: CampusLandmarksProps

  init(props: CampusLandmarksProps) {
    self.props = props
  }

  var body: some View {
    CampusLandmarksContent(props: props)
      // A changed signed-in identity must create a new store and navigation history.
      .id(props.storageScope)
  }
}

@MainActor
private struct CampusLandmarksContent: View {
  @ObservedObject var props: CampusLandmarksProps
  @StateObject private var store: CampusLandmarksStore
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var search = ""
  @State private var filter = PlaceFilter.all
  @State private var editor: CollectionEditorRequest?
  @State private var showingSettings = false
  @State private var confirmingRemoteReplacement = false

  init(props: CampusLandmarksProps) {
    self.props = props
    _store = StateObject(wrappedValue: CampusLandmarksStore(
      scope: props.storageScope,
      backendURL: props.backendURL,
      syncEnabled: props.syncEnabled
    ))
  }

  private var visiblePlaces: [RemoteLandmark] {
    store.landmarks.filter { place in
      let included = filter != .favorites || store.library.favoriteIDs.contains(place.id)
      let text = [place.name, place.description, place.continent, place.location ?? ""].joined(separator: " ")
      return included && (search.isEmpty || text.localizedStandardContains(search))
    }
  }

  private var visibleCollections: [CollectionSnapshot] {
    store.library.collections.filter {
      search.isEmpty || ($0.name + " " + $0.description).localizedStandardContains(search)
    }
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        Picker("แสดง", selection: $filter) {
          ForEach(PlaceFilter.allCases) { value in
            Text(value.rawValue).tag(value)
          }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)
        .padding(.vertical, 8)
        .accessibilityHint("เลือกสถานที่ทั้งหมด รายการโปรด หรือคอลเลกชัน")

        if store.hasConflict {
          conflictNotice
        } else if store.isSyncing {
          ProgressView("กำลังซิงก์ข้อมูล…")
            .padding(.vertical, 8)
            .accessibilityLabel("กำลังซิงก์สถานที่และคอลเลกชัน")
        } else if let message = store.syncMessage, !message.isEmpty {
          Text(message)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.bottom, 8)
        }

        List {
          if filter == .collections {
            collectionRows
          } else {
            placeRows
          }
        }
        .listStyle(.insetGrouped)
        .refreshable { await store.synchronize() }
      }
      .navigationTitle(props.title.isEmpty ? "สถานที่" : props.title)
      .navigationBarTitleDisplayMode(.large)
      .searchable(text: $search, prompt: filter == .collections ? "ค้นหาคอลเลกชัน" : "ค้นหาสถานที่")
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: filter)
      .toolbar {
        ToolbarItem(placement: .navigationBarLeading) {
          Button { props.onClose([:]) } label: {
            Image(systemName: "xmark")
              .frame(minWidth: 44, minHeight: 44)
          }
          .accessibilityLabel("ปิดหน้าสถานที่")
        }
        ToolbarItemGroup(placement: .navigationBarTrailing) {
          if filter == .collections {
            Button {
              if let id = store.nextCollectionID {
                editor = CollectionEditorRequest(collection: CollectionSnapshot(
                  id: id, name: "", description: "", landmarkIDs: []
                ))
              }
            } label: {
              Image(systemName: "plus").frame(minWidth: 44, minHeight: 44)
            }
            .disabled(store.library.collections.count >= 100 || store.nextCollectionID == nil)
            .accessibilityLabel("สร้างคอลเลกชัน")
          }
          Button { showingSettings = true } label: {
            Image(systemName: "icloud").frame(minWidth: 44, minHeight: 44)
          }
          .accessibilityLabel("ตั้งค่าการซิงก์")
        }
      }
    }
    .sheet(item: $editor) { request in
      CollectionEditor(store: store, initial: request.collection)
    }
    .sheet(isPresented: $showingSettings) {
      BackendSettings(store: store)
    }
    .confirmationDialog("แทนที่ข้อมูลในอุปกรณ์ด้วยข้อมูลบนเซิร์ฟเวอร์?", isPresented: $confirmingRemoteReplacement, titleVisibility: .visible) {
      Button("ใช้ข้อมูลจากเซิร์ฟเวอร์", role: .destructive) {
        Task { await store.resolveConflict(usingRemote: true) }
      }
      Button("ยกเลิก", role: .cancel) {}
    } message: {
      Text("รายการโปรดและคอลเลกชันที่แสดงในอุปกรณ์จะเปลี่ยนเป็นชุดข้อมูลจากเซิร์ฟเวอร์")
    }
    .task {
      store.onLibraryChange = { snapshot in
        props.onLibraryChange([
          "favoriteCount": snapshot.favoriteIDs.count,
          "collectionCount": snapshot.collections.count
        ])
      }
      await store.synchronize()
    }
    .onChange(of: props.backendURL) { url in
      store.configure(url: url, enabled: props.syncEnabled)
    }
    .onChange(of: props.syncEnabled) { enabled in
      store.configure(url: props.backendURL, enabled: enabled)
    }
    .onChange(of: scenePhase) { phase in
      if phase == .active { Task { await store.synchronize() } }
    }
    .onDisappear {
      store.onLibraryChange = nil
      store.stop()
    }
  }

  @ViewBuilder
  private var placeRows: some View {
    if visiblePlaces.isEmpty {
      EmptyLibraryRow(
        symbol: filter == .favorites ? "heart" : "magnifyingglass",
        title: search.isEmpty && filter == .favorites ? "ยังไม่มีรายการโปรด" : "ไม่พบสถานที่",
        message: filter == .favorites ? "กดหัวใจที่สถานที่เพื่อเก็บไว้ที่นี่" : "ลองเปลี่ยนคำค้นหา หรือดึงลงเพื่อโหลดข้อมูลอีกครั้ง"
      )
    } else {
      Section {
        ForEach(visiblePlaces, id: \.id) { place in
          HStack(spacing: 8) {
            NavigationLink {
              PlaceDetail(store: store, place: place, onSelect: props.onSelectPlace)
            } label: {
              PlaceRow(place: place)
            }
            Button { store.toggleFavorite(place.id) } label: {
              Image(systemName: store.library.favoriteIDs.contains(place.id) ? "heart.fill" : "heart")
                .foregroundStyle(store.library.favoriteIDs.contains(place.id) ? Color.pink : Color.secondary)
                .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(store.library.favoriteIDs.contains(place.id) ? "นำ \(place.name) ออกจากรายการโปรด" : "เพิ่ม \(place.name) ในรายการโปรด")
          }
        }
      } header: {
        Text("\(visiblePlaces.count) สถานที่")
      }
    }
  }

  @ViewBuilder
  private var collectionRows: some View {
    if visibleCollections.isEmpty {
      EmptyLibraryRow(
        symbol: "folder",
        title: search.isEmpty ? "เก็บสถานที่เป็นคอลเลกชัน" : "ไม่พบคอลเลกชัน",
        message: search.isEmpty ? "แตะปุ่มเพิ่มเพื่อจัดทริปหรือรวมสถานที่ที่อยากไป" : "ลองค้นหาด้วยชื่อหรือคำอธิบายอื่น"
      )
    } else {
      ForEach(visibleCollections, id: \.id) { collection in
        NavigationLink {
          CollectionDetail(store: store, collectionID: collection.id, onSelect: props.onSelectPlace)
        } label: {
          VStack(alignment: .leading, spacing: 4) {
            Label(collection.name, systemImage: "folder")
              .font(.headline)
            Text("\(collection.landmarkIDs.count) สถานที่")
              .font(.subheadline).foregroundStyle(.secondary)
          }
          .frame(minHeight: 44)
        }
        .swipeActions {
          Button("ลบ", role: .destructive) { store.deleteCollection(id: collection.id) }
        }
      }
    }
  }

  private var conflictNotice: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label("ข้อมูลในอุปกรณ์กับเซิร์ฟเวอร์มีการเปลี่ยนแปลง", systemImage: "icloud.slash")
        .font(.headline)
      Text("เลือกชุดข้อมูลที่ต้องการใช้ เพื่อซิงก์ต่อ")
        .font(.subheadline).foregroundStyle(.secondary)
      ViewThatFits(in: .horizontal) {
        HStack { conflictButtons }
        VStack(alignment: .leading) { conflictButtons }
      }
      .disabled(store.isSyncing)
    }
    .padding(12)
    .modifier(CampusGlassSurface())
    .padding(.horizontal)
    .padding(.vertical, 8)
  }

  @ViewBuilder
  private var conflictButtons: some View {
    Button("ใช้ข้อมูลในอุปกรณ์") { Task { await store.resolveConflict(usingRemote: false) } }
      .frame(minHeight: 44)
    Button("ใช้ข้อมูลจากเซิร์ฟเวอร์") { confirmingRemoteReplacement = true }
      .frame(minHeight: 44)
  }
}

private enum PlaceFilter: String, CaseIterable, Identifiable {
  case all = "ทั้งหมด"
  case favorites = "รายการโปรด"
  case collections = "คอลเลกชัน"
  var id: String { rawValue }
}

private struct CollectionEditorRequest: Identifiable {
  let id = UUID()
  let collection: CollectionSnapshot
}

private struct PlaceRow: View {
  let place: RemoteLandmark

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(place.name).font(.headline)
      Text(place.location ?? continentName(place.continent))
        .font(.subheadline).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
  }
}

private struct EmptyLibraryRow: View {
  let symbol: String
  let title: String
  let message: String

  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: symbol).font(.largeTitle).foregroundStyle(.secondary)
      Text(title).font(.headline).multilineTextAlignment(.center)
      Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 30)
    .accessibilityElement(children: .combine)
  }
}

@MainActor
private struct PlaceDetail: View {
  @ObservedObject var store: CampusLandmarksStore
  let place: RemoteLandmark
  let onSelect: EventDispatcher
  @State private var region: MKCoordinateRegion
  @State private var hasReportedSelection = false

  init(store: CampusLandmarksStore, place: RemoteLandmark, onSelect: EventDispatcher) {
    self.store = store
    self.place = place
    self.onSelect = onSelect
    let delta = min(max(place.span, 0.01), 180)
    _region = State(initialValue: MKCoordinateRegion(
      center: CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude),
      span: MKCoordinateSpan(latitudeDelta: delta, longitudeDelta: delta)
    ))
  }

  private var isFavorite: Bool { store.library.favoriteIDs.contains(place.id) }

  var body: some View {
    List {
      Section {
        VStack(alignment: .leading, spacing: 16) {
          Map(coordinateRegion: $region, annotationItems: [PlaceMarker(place: place)]) { marker in
            MapMarker(coordinate: marker.coordinate, tint: .accentColor)
          }
          .frame(height: 240)
          .clipShape(RoundedRectangle(cornerRadius: 12))
          .accessibilityLabel("แผนที่ \(place.name)")

          VStack(alignment: .leading, spacing: 8) {
            Text(place.name).font(.title2.bold())
            if let location = place.location, !location.isEmpty {
              Label(location, systemImage: "mappin.and.ellipse")
            }
            Label(continentName(place.continent), systemImage: "globe")
              .foregroundStyle(.secondary)
            Text(place.description).textSelection(.enabled)
          }
        }
        .padding(.vertical, 8)
      }

      Section {
        if store.library.collections.isEmpty {
          Text("สร้างคอลเลกชันจากหน้าหลัก แล้วเลือกบันทึกสถานที่ได้ที่นี่")
            .foregroundStyle(.secondary)
        } else {
          ForEach(store.library.collections, id: \.id) { collection in
            Toggle(collection.name, isOn: Binding(
              get: { collection.landmarkIDs.contains(place.id) },
              set: { store.setMembership(landmarkID: place.id, collectionID: collection.id, included: $0) }
            ))
            .frame(minHeight: 44)
            .accessibilityHint("บันทึกสถานที่ในคอลเลกชันนี้")
          }
        }
      } header: {
        Text("บันทึกในคอลเลกชัน")
      }
    }
    .safeAreaInset(edge: .bottom) {
      HStack(spacing: 12) {
        Button { store.toggleFavorite(place.id) } label: {
          Label(isFavorite ? "เลิกชอบ" : "รายการโปรด", systemImage: isFavorite ? "heart.fill" : "heart")
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .tint(.pink)
        .modifier(CampusGlassAction())

        Button {
          let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(
            latitude: place.latitude, longitude: place.longitude
          )))
          item.name = place.name
          item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking])
        } label: {
          Label("เปิดแผนที่", systemImage: "map.fill")
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .modifier(CampusGlassAction())
      }
      .padding()
      .background(.regularMaterial)
    }
    .navigationTitle(place.name)
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      guard !hasReportedSelection else { return }
      hasReportedSelection = true
      onSelect(["id": place.id, "name": place.name, "latitude": place.latitude, "longitude": place.longitude])
    }
  }
}

private struct PlaceMarker: Identifiable {
  let place: RemoteLandmark
  var id: Int { place.id }
  var coordinate: CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
  }
}

@MainActor
private struct CollectionDetail: View {
  @ObservedObject var store: CampusLandmarksStore
  let collectionID: Int
  let onSelect: EventDispatcher
  @Environment(\.dismiss) private var dismiss
  @State private var editing = false
  @State private var confirmingDelete = false

  private var collection: CollectionSnapshot? {
    store.library.collections.first { $0.id == collectionID }
  }

  var body: some View {
    Group {
      if let collection {
        List {
          if !collection.description.isEmpty {
            Section { Text(collection.description).textSelection(.enabled) }
          }
          Section {
            if collection.landmarkIDs.isEmpty {
              EmptyLibraryRow(symbol: "mappin", title: "ยังไม่มีสถานที่", message: "แตะแก้ไขเพื่อเลือกสถานที่ในคอลเลกชัน")
            } else {
              ForEach(collection.landmarkIDs, id: \.self) { id in
                if let place = store.landmarks.first(where: { $0.id == id }) {
                  NavigationLink {
                    PlaceDetail(store: store, place: place, onSelect: onSelect)
                  } label: {
                    PlaceRow(place: place)
                  }
                  .swipeActions {
                    Button("นำออก", role: .destructive) {
                      store.setMembership(landmarkID: id, collectionID: collectionID, included: false)
                    }
                  }
                }
              }
            }
          } header: {
            Text("\(collection.landmarkIDs.count) สถานที่")
          }
        }
        .navigationTitle(collection.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItemGroup(placement: .navigationBarTrailing) {
            Button("แก้ไข") { editing = true }.frame(minHeight: 44)
            Button(role: .destructive) { confirmingDelete = true } label: {
              Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("ลบคอลเลกชัน")
          }
        }
        .sheet(isPresented: $editing) { CollectionEditor(store: store, initial: collection) }
      } else {
        EmptyLibraryRow(symbol: "folder", title: "ไม่พบคอลเลกชันนี้", message: "ข้อมูลอาจเปลี่ยนหลังจากการซิงก์")
      }
    }
    .confirmationDialog("ลบคอลเลกชันนี้?", isPresented: $confirmingDelete, titleVisibility: .visible) {
      Button("ลบคอลเลกชัน", role: .destructive) {
        store.deleteCollection(id: collectionID)
        dismiss()
      }
      Button("ยกเลิก", role: .cancel) {}
    } message: {
      Text("สถานที่และรายการโปรดยังคงอยู่")
    }
  }
}

@MainActor
private struct CollectionEditor: View {
  @ObservedObject var store: CampusLandmarksStore
  let initial: CollectionSnapshot
  @Environment(\.dismiss) private var dismiss
  @State private var name: String
  @State private var description: String
  @State private var selectedIDs: [Int]
  @State private var search = ""

  init(store: CampusLandmarksStore, initial: CollectionSnapshot) {
    self.store = store
    self.initial = initial
    _name = State(initialValue: initial.name)
    _description = State(initialValue: initial.description)
    _selectedIDs = State(initialValue: initial.landmarkIDs)
  }

  private var title: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var valid: Bool { !title.isEmpty && title.utf8.count <= 120 && description.utf8.count <= 4000 }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("ชื่อคอลเลกชัน", text: $name)
            .frame(minHeight: 44)
          TextField("คำอธิบาย", text: $description, axis: .vertical)
            .lineLimit(3...6)
        } footer: {
          if title.utf8.count > 120 { Text("ชื่อยาวเกินไป กรุณาย่อให้สั้นลง") }
          if description.utf8.count > 4000 { Text("คำอธิบายยาวเกินไป กรุณาย่อให้สั้นลง") }
        }

        Section {
          ForEach(store.landmarks.filter { search.isEmpty || $0.name.localizedStandardContains(search) }, id: \.id) { place in
            Toggle(isOn: Binding(
              get: { selectedIDs.contains(place.id) },
              set: { included in
                if included && !selectedIDs.contains(place.id) { selectedIDs.append(place.id) }
                if !included { selectedIDs.removeAll { $0 == place.id } }
              }
            )) {
              PlaceRow(place: place)
            }
            .frame(minHeight: 44)
          }
        } header: {
          Text("เลือกสถานที่ (\(selectedIDs.count))")
        }
      }
      .navigationTitle(initial.name.isEmpty ? "สร้างคอลเลกชัน" : "แก้ไขคอลเลกชัน")
      .navigationBarTitleDisplayMode(.inline)
      .searchable(text: $search, prompt: "ค้นหาสถานที่")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("ยกเลิก") { dismiss() }.frame(minHeight: 44)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("บันทึก") {
            guard valid else { return }
            store.upsertCollection(CollectionSnapshot(
              id: initial.id, name: title, description: description, landmarkIDs: selectedIDs
            ))
            dismiss()
          }
          .frame(minHeight: 44)
          .disabled(!valid)
        }
      }
    }
  }
}

@MainActor
private struct BackendSettings: View {
  @ObservedObject var store: CampusLandmarksStore
  @Environment(\.dismiss) private var dismiss
  @State private var url: String
  @State private var enabled: Bool

  init(store: CampusLandmarksStore) {
    self.store = store
    _url = State(initialValue: store.backendURL)
    _enabled = State(initialValue: store.syncEnabled)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Toggle("ซิงก์รายการโปรดและคอลเลกชัน", isOn: $enabled).frame(minHeight: 44)
          TextField("https://api.example.com", text: $url)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .frame(minHeight: 44)
            .accessibilityLabel("ที่อยู่เซิร์ฟเวอร์ Rust")
        } header: {
          Text("เซิร์ฟเวอร์ Rust")
        } footer: {
          Text("ใช้ที่อยู่ HTTPS ข้อมูลสถานที่ดูได้ออฟไลน์ ส่วนการซิงก์ใช้เซสชันแยกตามผู้ใช้บนอุปกรณ์นี้")
        }
        if let message = store.syncMessage { Section { Text(message).font(.footnote) } }
      }
      .navigationTitle("ตั้งค่าการซิงก์")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("ยกเลิก") { dismiss() }.frame(minHeight: 44) }
        ToolbarItem(placement: .confirmationAction) {
          Button("บันทึก") {
            store.configure(url: url.trimmingCharacters(in: .whitespacesAndNewlines), enabled: enabled)
            Task { await store.synchronize() }
            dismiss()
          }
          .frame(minHeight: 44)
          .disabled(enabled && url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    }
  }
}

private struct CampusGlassSurface: ViewModifier {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  @ViewBuilder
  func body(content: Content) -> some View {
    if reduceTransparency {
      content.background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
    } else {
      #if compiler(>=6.2)
      if #available(iOS 26.0, *) {
        content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16))
      } else {
        content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
      }
      #else
      content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
      #endif
    }
  }
}

private struct CampusGlassAction: ViewModifier {
  @ViewBuilder
  func body(content: Content) -> some View {
    #if compiler(>=6.2)
    if #available(iOS 26.0, *) {
      content.buttonStyle(.glass)
    } else {
      content.buttonStyle(.bordered)
    }
    #else
    content.buttonStyle(.bordered)
    #endif
  }
}

private func continentName(_ value: String) -> String {
  switch value.lowercased() {
  case "africa": return "แอฟริกา"
  case "antarctica": return "แอนตาร์กติกา"
  case "asia": return "เอเชีย"
  case "australia", "australiaoceania", "australia/oceania", "oceania": return "ออสเตรเลียและโอเชียเนีย"
  case "europe": return "ยุโรป"
  case "northamerica", "north america": return "อเมริกาเหนือ"
  case "southamerica", "south america": return "อเมริกาใต้"
  default: return value
  }
}
