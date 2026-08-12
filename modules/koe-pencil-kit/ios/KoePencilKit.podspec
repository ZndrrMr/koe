Pod::Spec.new do |s|
  s.name = 'KoePencilKit'
  s.version = '0.1.0'
  s.summary = 'A bounded PencilKit and handwriting-recognition surface for Koe.'
  s.description = 'Keeps low-latency ink and Vision recognition native while exposing semantic practice events to Expo.'
  s.author = 'Zander'
  s.homepage = 'https://github.com/zndrr/koe'
  s.license = { :type => 'MIT' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
