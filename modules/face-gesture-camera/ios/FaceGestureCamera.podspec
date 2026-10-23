Pod::Spec.new do |s|
  s.name = 'FaceGestureCamera'
  s.version = '1.0.0'
  s.summary = 'Front camera with on-device face tracking'
  s.description = 'Camera preview, head pose and eye estimates for the photo verification gesture phase.'
  s.license = { :type => 'MIT' }
  s.author = 'CampusMate'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Vision', 'CoreImage', 'ImageIO'
  s.source_files = '**/*.{h,m,mm,swift}'
end
