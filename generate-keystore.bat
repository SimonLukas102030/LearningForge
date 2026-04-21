@echo off
setlocal

set KEYSTORE=keystore.jks
set ALIAS=learningforge
set PASS=learningforge123

echo Generiere Keystore...
keytool -genkey -v ^
  -keystore %KEYSTORE% ^
  -alias %ALIAS% ^
  -keyalg RSA -keysize 2048 -validity 10000 ^
  -storepass %PASS% -keypass %PASS% ^
  -dname "CN=LearningForge, O=SimonsStudios, C=DE" 2>nul

if not exist %KEYSTORE% (
    echo FEHLER: keytool nicht gefunden. Bitte Java/JDK installieren.
    echo Download: https://adoptium.net
    pause
    exit /b 1
)

echo.
echo ========================================
echo SHA-256 Fingerabdruck (fuer assetlinks.json):
echo ========================================
keytool -list -v -keystore %KEYSTORE% -alias %ALIAS% -storepass %PASS% 2>nul | findstr "SHA256"
echo ========================================
echo.
echo ========================================
echo KEYSTORE_BASE64 (als GitHub Secret speichern):
echo ========================================
powershell -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('%~dp0%KEYSTORE%'))"
echo ========================================
echo.
echo Fertig! keystore.jks wurde erstellt.
echo WICHTIG: keystore.jks NICHT in Git committen!
pause
