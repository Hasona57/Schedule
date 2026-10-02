@echo off
title Nile University APK Builder

echo ====================================================
echo   Nile University Smart Timetable - APK Builder
echo ====================================================
echo.

set "BASE_DIR=%USERPROFILE%\flutter_sdk"
if not exist "%BASE_DIR%" mkdir "%BASE_DIR%"

:: --------------------------------------------------------
:: 1. SETUP JAVA JDK 17
:: --------------------------------------------------------
if exist "%BASE_DIR%\jdk-17\bin\java.exe" (
    "%BASE_DIR%\jdk-17\bin\java.exe" -version >nul 2>&1
    if %ERRORLEVEL% equ 0 goto JDK_READY
    echo [!] Previous Java installation is corrupted. Re-downloading...
    rd /s /q "%BASE_DIR%\jdk-17" 2>nul
)

:DOWNLOAD_JDK
echo [*] Downloading Microsoft OpenJDK 17 (resumable download)...
curl -L -C - --retry 10 --retry-all-errors --retry-delay 2 --progress-bar -o "%BASE_DIR%\jdk.zip" "https://download.visualstudio.microsoft.com/download/pr/58dca6c6-c3c9-4daa-8e17-b7d0df501afc/667a0e2c93e1aab8df0707a31c42d190/microsoft-jdk-17.0.12-windows-x64.zip"

if %ERRORLEVEL% neq 0 (
    echo [!] Connection interrupted. Retrying download from current point...
    timeout /t 3 >nul
    goto DOWNLOAD_JDK
)

echo [*] Extracting JDK 17...
tar -xf "%BASE_DIR%\jdk.zip" -C "%BASE_DIR%"
if %ERRORLEVEL% neq 0 (
    echo [!] Extraction failed. Resuming download...
    goto DOWNLOAD_JDK
)

del "%BASE_DIR%\jdk.zip" 2>nul
for /d %%D in ("%BASE_DIR%\jdk-17*" "%BASE_DIR%\microsoft-jdk-17*") do (
    if not "%%~nxD"=="jdk-17" ren "%%D" "jdk-17" 2>nul
)

:JDK_READY
set "JAVA_HOME=%BASE_DIR%\jdk-17"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo [OK] Java JDK 17 ready.

:: --------------------------------------------------------
:: 2. SETUP FLUTTER SDK
:: --------------------------------------------------------
if exist "%BASE_DIR%\flutter\bin\flutter.bat" goto FLUTTER_READY

:DOWNLOAD_FLUTTER
echo [*] Downloading Flutter SDK (resumable download)...
curl -L -C - --retry 10 --retry-all-errors --retry-delay 2 --progress-bar -o "%BASE_DIR%\flutter.zip" "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.24.3-stable.zip"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Connection interrupted. Retrying Flutter download...
    timeout /t 3 >nul
    goto DOWNLOAD_FLUTTER
)

echo [*] Extracting Flutter SDK...
tar -xf "%BASE_DIR%\flutter.zip" -C "%BASE_DIR%"
if %ERRORLEVEL% neq 0 (
    goto DOWNLOAD_FLUTTER
)
del "%BASE_DIR%\flutter.zip" 2>nul

:FLUTTER_READY
set "PATH=%BASE_DIR%\flutter\bin;%PATH%"
echo [OK] Flutter SDK ready.

:: --------------------------------------------------------
:: 3. SETUP ANDROID SDK & AUTO-ACCEPT LICENSES
:: --------------------------------------------------------
set "ANDROID_HOME=%BASE_DIR%\android-sdk"
set "ANDROID_SDK_ROOT=%BASE_DIR%\android-sdk"

if not exist "%ANDROID_HOME%\licenses" mkdir "%ANDROID_HOME%\licenses"
echo 24333f8a63b6825ea9c5514f83c2829b004d1fee> "%ANDROID_HOME%\licenses\android-sdk-license"
echo 8933ed6d10575d18224978f00870bf095d5dd4fb>> "%ANDROID_HOME%\licenses\android-sdk-license"
echo d56f5187479451eabf01fb78af6dfcb131a6481e>> "%ANDROID_HOME%\licenses\android-sdk-license"
echo 84831b9409646a53fe44fe734870d7508d0f4dac> "%ANDROID_HOME%\licenses\android-sdk-preview-license"

if exist "%ANDROID_HOME%\platforms\android-34\android.jar" goto ANDROID_READY

if not exist "%ANDROID_HOME%\cmdline-tools" mkdir "%ANDROID_HOME%\cmdline-tools"

if exist "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" goto INSTALL_PACKAGES

:DOWNLOAD_CMDLINE
echo [*] Downloading Android Command-Line Tools...
curl -L -C - --retry 10 --retry-all-errors --retry-delay 2 --progress-bar -o "%BASE_DIR%\cmdline-tools.zip" "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
if %ERRORLEVEL% neq 0 (
    timeout /t 3 >nul
    goto DOWNLOAD_CMDLINE
)

tar -xf "%BASE_DIR%\cmdline-tools.zip" -C "%ANDROID_HOME%\cmdline-tools"
if %ERRORLEVEL% neq 0 (
    goto DOWNLOAD_CMDLINE
)
del "%BASE_DIR%\cmdline-tools.zip" 2>nul
if exist "%ANDROID_HOME%\cmdline-tools\cmdline-tools" (
    ren "%ANDROID_HOME%\cmdline-tools\cmdline-tools" "latest" 2>nul
)

:INSTALL_PACKAGES
echo [*] Downloading Android 34 Platform and Build Tools...
call "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="%ANDROID_HOME%" "platform-tools" "platforms;android-34" "build-tools;34.0.0"

:ANDROID_READY
echo [OK] Android SDK ready.

:: --------------------------------------------------------
:: 4. SETUP GRADLE (Resumable Download & Auto-Extract)
:: --------------------------------------------------------
set "GRADLE_DIR=%USERPROFILE%\.gradle\wrapper\dists\gradle-8.3-all\6en3ugtfdg5xnpx44z4qbwgas"
if not exist "%GRADLE_DIR%" mkdir "%GRADLE_DIR%"

if exist "%GRADLE_DIR%\gradle-8.3\bin\gradle" goto GRADLE_READY

echo [*] Downloading Gradle 8.3 build system (resumable)...
curl -L -C - --retry 10 --retry-all-errors --retry-delay 2 --progress-bar -o "%GRADLE_DIR%\gradle-8.3-all.zip" "https://services.gradle.org/distributions/gradle-8.3-all.zip"

echo [*] Extracting Gradle 8.3...
tar -xf "%GRADLE_DIR%\gradle-8.3-all.zip" -C "%GRADLE_DIR%"
echo. > "%GRADLE_DIR%\gradle-8.3-all.zip.ok"
del "%GRADLE_DIR%\gradle-8.3-all.zip.lck" 2>nul

:GRADLE_READY
echo [OK] Gradle build system ready.

:: --------------------------------------------------------
:: 5. CONFIGURE FLUTTER AND BUILD APK
:: --------------------------------------------------------
echo [*] Configuring Flutter SDK paths...
call flutter config --android-sdk "%ANDROID_HOME%" --no-analytics >nul 2>&1

echo.
echo ====================================================
echo   Building Release APK
echo ====================================================
echo.

cd /d "%~dp0flutter_app"

if not exist "android\build.gradle" (
    echo [*] Generating Android build structure...
    call flutter create . --platforms=android --org eg.edu.nu
)

echo [*] Fetching dependencies...
call flutter pub get

echo.
echo [*] Compiling release APK (this may take 2-4 minutes)...
call flutter build apk --release

if %ERRORLEVEL% equ 0 (
    echo.
    echo ====================================================
    echo   BUILD COMPLETED SUCCESSFULLY!
    echo ====================================================
    echo Opening output folder...
    start "" explorer "%~dp0flutter_app\build\app\outputs\flutter-apk"
) else (
    echo.
    echo [ERROR] Build encountered an issue. Review logs above.
)

:SCRIPT_END
echo.
echo Press any key to exit...
pause >nul
