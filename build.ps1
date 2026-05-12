# Pluma release builder
$vcVer = "14.44.35207"
$sdkVer = "10.0.22621.0"

$env:PATH = "C:\BuildTools\VC\Tools\MSVC\$vcVer\bin\Hostx64\x64;" +
            "C:\BuildTools\Common7\Tools;" +
            "C:\Program Files (x86)\Windows Kits\10\bin\$sdkVer\x64;" +
            "$env:USERPROFILE\.cargo\bin;" +
            $env:PATH

$env:LIB = "C:\BuildTools\VC\Tools\MSVC\$vcVer\lib\x64;" +
           "C:\Program Files (x86)\Windows Kits\10\Lib\$sdkVer\um\x64;" +
           "C:\Program Files (x86)\Windows Kits\10\Lib\$sdkVer\ucrt\x64"

$env:INCLUDE = "C:\BuildTools\VC\Tools\MSVC\$vcVer\include;" +
               "C:\Program Files (x86)\Windows Kits\10\Include\$sdkVer\ucrt;" +
               "C:\Program Files (x86)\Windows Kits\10\Include\$sdkVer\um;" +
               "C:\Program Files (x86)\Windows Kits\10\Include\$sdkVer\shared"

npm run tauri build
