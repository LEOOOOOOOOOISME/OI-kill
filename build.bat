@echo off
REM ==========================================================================
REM  build.bat - One-click build for the OI-Kill server
REM  Encoding policy (key to fixing "mojibake/JSON crash"):
REM    1) Source files are stored as UTF-8 (all files in this project are UTF-8)
REM    2) -finput-charset=UTF-8  tells the compiler the source is UTF-8
REM    3) -fexec-charset=UTF-8   makes all Chinese string literals UTF-8 at runtime
REM       - This is REQUIRED !!! nlohmann::json strictly requires UTF-8.
REM         If GBK is used, any JSON response containing Chinese (j.dump())
REM         will crash the server with type_error.316 invalid UTF-8 byte.
REM       - HTML/JSON bodies are sent as-is in UTF-8; the browser meta
REM         charset=UTF-8 displays Chinese correctly.
REM    4) -std=c++11 : the project targets C++11. game_engine.cpp must NOT
REM       use C++14-only syntax (no std::make_unique / chrono 15s literals).
REM  Do NOT switch to -fexec-charset=GBK (JSON will crash).
REM ==========================================================================
chcp 65001 >NUL

set "GXX=C:\Program Files (x86)\Dev-Cpp\MinGW64\bin\g++.exe"
if not exist "%GXX%" set "GXX=g++"

"%GXX%" ^
  -std=c++11 ^
  -O2 ^
  -Wall ^
  -I. ^
  -finput-charset=UTF-8 ^
  -fexec-charset=UTF-8 ^
  main.cpp network_server.cpp game_engine.cpp room_manager.cpp ^
  -o OIKillServer.exe ^
  -lws2_32 ^
  -static-libgcc -static-libstdc++

if errorlevel 1 (
  echo BUILD FAILED: check that nlohmann/json.hpp and all sources exist.
  echo All source files must be UTF-8 encoded.
  exit /b 1
)

echo.
echo BUILD OK: OIKillServer.exe (UTF-8 exec charset, C++11)
exit /b 0