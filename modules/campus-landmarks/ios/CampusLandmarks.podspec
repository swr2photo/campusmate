Pod::Spec.new do |s|
  s.name           = 'CampusLandmarks'
  s.version        = '1.0.0'
  s.summary        = 'CampusMate native SwiftUI places library'
  s.description    = 'Places, favorites and collections with optional Rust backend synchronization.'
  s.author         = 'CampusMate'
  s.license        = { :type => 'MIT', :file => '../LICENSE' }
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version = '6.0'

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  s.resource_bundles = { 'CampusLandmarks' => ['Resources/catalog.json', 'Resources/PrivacyInfo.xcprivacy'] }
end
