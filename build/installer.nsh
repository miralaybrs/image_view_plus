!macro RegisterImageExt EXT
  WriteRegStr HKCU "Software\ImageViewPlus\Capabilities\FileAssociations" "${EXT}" "ImageViewPlus.Photo"
  WriteRegStr HKCU "Software\Classes\${EXT}" "" "ImageViewPlus.Photo"
  WriteRegStr HKCU "Software\Classes\${EXT}\OpenWithProgids" "ImageViewPlus.Photo" ""
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\ImageViewPlus" "" "ImageView+"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\ImageViewPlus" "Icon" '"$INSTDIR\ImageView+.exe",0'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\ImageViewPlus\command" "" '"$INSTDIR\ImageView+.exe" "%1"'
!macroend

!macro customInstall
  ; Register ProgID ImageViewPlus.Photo with clean "ImageView+" FriendlyAppName
  WriteRegStr HKCU "Software\Classes\ImageViewPlus.Photo" "" "ImageView+"
  WriteRegStr HKCU "Software\Classes\ImageViewPlus.Photo" "FriendlyTypeName" "ImageView+"
  WriteRegStr HKCU "Software\Classes\ImageViewPlus.Photo" "FriendlyAppName" "ImageView+"
  WriteRegStr HKCU "Software\Classes\ImageViewPlus.Photo\DefaultIcon" "" '"$INSTDIR\ImageView+.exe",0'
  WriteRegStr HKCU "Software\Classes\ImageViewPlus.Photo\shell\open" "FriendlyAppName" "ImageView+"
  WriteRegStr HKCU "Software\Classes\ImageViewPlus.Photo\shell\open\command" "" '"$INSTDIR\ImageView+.exe" "%1"'

  ; Register Applications\ImageView+.exe FriendlyAppName
  WriteRegStr HKCU "Software\Classes\Applications\ImageView+.exe" "FriendlyAppName" "ImageView+"
  WriteRegStr HKCU "Software\Classes\Applications\ImageView+.exe\DefaultIcon" "" '"$INSTDIR\ImageView+.exe",0'
  WriteRegStr HKCU "Software\Classes\Applications\ImageView+.exe\shell\open\command" "" '"$INSTDIR\ImageView+.exe" "%1"'

  ; Register Capabilities & RegisteredApplications
  WriteRegStr HKCU "Software\ImageViewPlus\Capabilities" "ApplicationName" "ImageView+"
  WriteRegStr HKCU "Software\ImageViewPlus\Capabilities" "ApplicationDescription" "ImageView+"
  WriteRegStr HKCU "Software\RegisteredApplications" "ImageView+" "Software\ImageViewPlus\Capabilities"

  ; Associate all 36+ popular, RAW/DNG, WebP, and Pro image extensions
  !insertmacro RegisterImageExt ".dng"
  !insertmacro RegisterImageExt ".webp"
  !insertmacro RegisterImageExt ".jpg"
  !insertmacro RegisterImageExt ".jpeg"
  !insertmacro RegisterImageExt ".jpe"
  !insertmacro RegisterImageExt ".jfif"
  !insertmacro RegisterImageExt ".png"
  !insertmacro RegisterImageExt ".apng"
  !insertmacro RegisterImageExt ".gif"
  !insertmacro RegisterImageExt ".bmp"
  !insertmacro RegisterImageExt ".dib"
  !insertmacro RegisterImageExt ".tga"
  !insertmacro RegisterImageExt ".tif"
  !insertmacro RegisterImageExt ".tiff"
  !insertmacro RegisterImageExt ".avif"
  !insertmacro RegisterImageExt ".heic"
  !insertmacro RegisterImageExt ".heif"
  !insertmacro RegisterImageExt ".svg"
  !insertmacro RegisterImageExt ".ico"
  !insertmacro RegisterImageExt ".psd"
  !insertmacro RegisterImageExt ".ppm"
  !insertmacro RegisterImageExt ".pgm"
  !insertmacro RegisterImageExt ".pnm"
  !insertmacro RegisterImageExt ".pcx"
  !insertmacro RegisterImageExt ".hdr"
  !insertmacro RegisterImageExt ".jp2"
  !insertmacro RegisterImageExt ".jxl"
  !insertmacro RegisterImageExt ".cr2"
  !insertmacro RegisterImageExt ".cr3"
  !insertmacro RegisterImageExt ".nef"
  !insertmacro RegisterImageExt ".arw"
  !insertmacro RegisterImageExt ".orf"
  !insertmacro RegisterImageExt ".rw2"
  !insertmacro RegisterImageExt ".pef"
  !insertmacro RegisterImageExt ".raf"
  !insertmacro RegisterImageExt ".srw"

  ; Notify Windows Shell to refresh icons and associations immediately
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\ImageViewPlus.Photo"
  DeleteRegKey HKCU "Software\ImageViewPlus"
  DeleteRegValue HKCU "Software\RegisteredApplications" "ImageView+"
  System::Call 'shell32.dll::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
