require 'json'

Pod::Spec.new do |s|
  s.name           = 'CampusFaceLiveness'
  s.version        = '0.1.0'
  s.summary        = 'CampusMate bridge to AWS Amplify UI Face Liveness (SwiftUI)'
  s.description    = 'Presents the AWS-maintained FaceLivenessDetectorView; the server decides the result.'
  s.author         = 'CampusMate'
  s.license        = { :type => 'MIT' }
  s.homepage       = 'https://ui.docs.amplify.aws/swift/connected-components/liveness'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  # Not 'FaceLiveness': that name is the AWS Swift module imported below.
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # The AWS component ships through Swift Package Manager only. React Native's
  # `spm_dependency` helper (RN >= 0.75) links it into this pod. Verify on the
  # Expo 58 / Xcode 26 toolchain during the compatibility spike.
  if defined?(spm_dependency)
    spm_dependency(s,
      url: 'https://github.com/aws-amplify/amplify-ui-swift-liveness',
      requirement: { kind: 'exactVersion', version: '1.5.0' },
      products: ['FaceLiveness']
    )
    # `AWSCredentialsProvider` / `AWSTemporaryCredentials` live here; the
    # range lets SwiftPM pick the version the liveness package resolves.
    spm_dependency(s,
      url: 'https://github.com/aws-amplify/amplify-swift',
      requirement: { kind: 'upToNextMajorVersion', minimumVersion: '2.0.0' },
      products: ['AWSPluginsCore']
    )
  else
    raise 'FaceLiveness requires React Native spm_dependency support'
  end

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
