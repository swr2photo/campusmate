Pod::Spec.new do |s|
  s.name = 'ChatVideoProcessor'
  s.version = '1.0.0'
  s.summary = 'Local chat video editing'
  s.description = 'Trim, mute and encode chat videos before encrypted upload.'
  s.license = { :type => 'MIT' }
  s.author = 'CampusMate'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
end
