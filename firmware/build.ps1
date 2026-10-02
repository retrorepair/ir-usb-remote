<#
.SYNOPSIS
    Builds the IR USB Remote firmware and produces a .uf2 to drag onto the board.

.DESCRIPTION
    Finds the toolchain rather than requiring it on PATH, because the pieces
    install to awkward places on Windows (winget package folders, Program
    Files, a per-user Python). Override any of them with the matching
    environment variable if you keep yours somewhere else.

    Four things are needed:
      cmake, ninja          the build itself
      arm-none-eabi-gcc     the cross compiler
      python                the SDK's boot-stage-2 padding script
      a host gcc            the SDK builds picotool to generate the .uf2

.PARAMETER Board
    PICO_BOARD value: pico, pico_w, pico2, or any board the SDK knows.

.PARAMETER IrGpio
    GPIO the receiver's OUT pin is wired to. Default 3.

.PARAMETER UsbVid / UsbPid
    USB ids. The defaults are the pid.codes test pair and must NOT ship on
    hardware you sell -- see docs/branding.md.

.EXAMPLE
    .\build.ps1
    .\build.ps1 -Board pico_w -IrGpio 2
    .\build.ps1 -UsbVid 0x1209 -UsbPid 0xC0DE -Clean

.NOTES
    The USB id parameters are UsbVid/UsbPid rather than Vid/Pid because $Pid is
    a read-only PowerShell automatic variable holding the process id, and
    binding a parameter to that name fails at invocation.
#>
[CmdletBinding()]
param(
    [string]$Board  = 'pico',
    [int]$IrGpio    = 3,
    [string]$UsbVid = '0x1209',
    [string]$UsbPid = '0x0001',
    [string]$BuildType = 'Release',
    [switch]$Clean,
    [switch]$Test
)

# Deliberately NOT 'Stop'. CMake and the Pico SDK write progress and
# informational messages to stderr, and under 'Stop' PowerShell turns the
# first such line from a native command into a terminating error -- so a
# perfectly successful build aborts. Every native call below checks
# $LASTEXITCODE explicitly instead, which is the reliable signal.
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot

function Find-Tool {
    param(
        [string]$Name,
        [string]$EnvVar,
        [string[]]$Candidates,
        # Paths matching this wildcard are ignored even if found on PATH.
        [string]$Reject
    )

    if ($EnvVar -and (Test-Path env:$EnvVar)) {
        $v = (Get-Item env:$EnvVar).Value
        if (Test-Path $v) { return $v }
        throw "$EnvVar points at '$v', which does not exist."
    }
    # Name is optional: some tools are only ever looked up by path.
    if ($Name) {
        $onPath = Get-Command $Name -ErrorAction SilentlyContinue
        if ($onPath -and -not ($Reject -and $onPath.Source -like $Reject)) {
            return $onPath.Source
        }
    }
    foreach ($c in $Candidates) {
        $hit = Get-ChildItem -Path $c -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($hit -and -not ($Reject -and $hit.FullName -like $Reject)) {
            return $hit.FullName
        }
    }
    return $null
}

$wingetPkgs = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages"

$cmake = Find-Tool 'cmake' 'CMAKE_EXE' @(
    'C:\Program Files\CMake\bin\cmake.exe',
    "$wingetPkgs\Kitware.CMake*\bin\cmake.exe"
)
$ninja = Find-Tool 'ninja' 'NINJA_EXE' @(
    "$wingetPkgs\Ninja-build.Ninja*\ninja.exe",
    "$wingetPkgs\BrechtSanders.WinLibs*\mingw64\bin\ninja.exe"
)
$armGcc = Find-Tool 'arm-none-eabi-gcc' $null @(
    "$env:USERPROFILE\arm-toolchain\bin\arm-none-eabi-gcc.exe",
    'C:\Program Files (x86)\Arm GNU Toolchain*\*\bin\arm-none-eabi-gcc.exe',
    'C:\Program Files\Arm GNU Toolchain*\*\bin\arm-none-eabi-gcc.exe'
)
# Windows ships an "App execution alias" stub at WindowsApps\python.exe that
# only opens the Microsoft Store. It sits on PATH ahead of real installs and
# would be picked first, then fail the SDK's boot-stage-2 script with a
# baffling error, so it is rejected by path.
$python = Find-Tool 'python' 'PYTHON_EXE' @(
    "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe",
    'C:\Python3*\python.exe',
    "$env:ProgramFiles\Python3*\python.exe"
) -Reject '*\WindowsApps\*'
# picotool is a host program, so this must be a native compiler, not the cross
# one. Looking for plain 'gcc' is safe: the cross compiler is always named
# arm-none-eabi-gcc and can never be picked up by that name.
$hostGcc = Find-Tool 'gcc' 'HOST_GCC' @(
    "$wingetPkgs\BrechtSanders.WinLibs*\mingw64\bin\gcc.exe",
    'C:\msys64\mingw64\bin\gcc.exe'
)

$sdk = if (Test-Path env:PICO_SDK_PATH) { $env:PICO_SDK_PATH } else { "$env:USERPROFILE\pico-sdk" }

$missing = @()
if (-not $cmake)   { $missing += 'cmake        (winget install Kitware.CMake)' }
if (-not $ninja)   { $missing += 'ninja        (winget install Ninja-build.Ninja)' }
if (-not $armGcc)  { $missing += 'arm-none-eabi-gcc  (see docs/flashing.md)' }
if (-not $python)  { $missing += 'python       (winget install Python.Python.3.12 --scope user)' }
if (-not $hostGcc) { $missing += 'host gcc     (winget install BrechtSanders.WinLibs.POSIX.UCRT)' }
if (-not (Test-Path $sdk)) {
    $missing += "pico-sdk at '$sdk'  (git clone -b 2.1.1 https://github.com/raspberrypi/pico-sdk)"
}
if ($missing.Count) {
    Write-Host 'Missing build prerequisites:' -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" }
    exit 1
}

$armBin   = Split-Path $armGcc -Parent
$armRoot  = Split-Path $armBin -Parent
$ninjaBin = Split-Path $ninja -Parent
$pyBin    = Split-Path $python -Parent
$hostBin  = Split-Path $hostGcc -Parent

Write-Host 'Toolchain' -ForegroundColor Cyan
Write-Host "  cmake      $cmake"
Write-Host "  ninja      $ninja"
Write-Host "  arm gcc    $armGcc"
Write-Host "  python     $python"
Write-Host "  host gcc   $hostGcc"
Write-Host "  pico-sdk   $sdk"
Write-Host ''

$env:PATH = "$ninjaBin;$pyBin;$hostBin;$env:PATH"

$buildDir = Join-Path $here 'build'
if ($Clean -and (Test-Path $buildDir)) {
    Write-Host 'Removing previous build output' -ForegroundColor Yellow
    Remove-Item -Recurse -Force $buildDir
}

# --- host-side decoder tests --------------------------------------------
if ($Test) {
    Write-Host 'Building and running the decoder tests' -ForegroundColor Cyan
    $testOut = Join-Path $here 'build-test'
    New-Item -ItemType Directory -Force $testOut | Out-Null
    $exe = Join-Path $testOut 'ir_decode_tests.exe'
    & $hostGcc -std=c11 -Wall -Wextra -Wno-unused-parameter `
        "-I$(Join-Path $here 'include')" `
        (Join-Path $here 'test\test_decode.c') `
        (Join-Path $here 'src\ir_decode.c') `
        (Join-Path $here 'src\ir_protocol.c') `
        -o $exe
    if ($LASTEXITCODE -ne 0) { Write-Host 'Test build failed.' -ForegroundColor Red; exit 1 }
    & $exe
    if ($LASTEXITCODE -ne 0) { Write-Host 'Decoder tests FAILED.' -ForegroundColor Red; exit 1 }
    Write-Host ''
}

# --- configure -----------------------------------------------------------
& $cmake -G Ninja -B $buildDir -S $here `
    "-DPICO_SDK_PATH=$($sdk -replace '\\','/')" `
    "-DPICO_TOOLCHAIN_PATH=$($armRoot -replace '\\','/')" `
    "-DPICO_BOARD=$Board" `
    "-DCMAKE_BUILD_TYPE=$BuildType" `
    "-DIR_GPIO=$IrGpio" `
    "-DUSB_VID=$UsbVid" `
    "-DUSB_PID=$UsbPid" `
    "-DCMAKE_MAKE_PROGRAM=$($ninja -replace '\\','/')" `
    '-DCMAKE_POLICY_VERSION_MINIMUM=3.5'
if ($LASTEXITCODE -ne 0) { Write-Host 'Configure failed.' -ForegroundColor Red; exit 1 }

# --- build ---------------------------------------------------------------
& $cmake --build $buildDir
if ($LASTEXITCODE -ne 0) { Write-Host 'Build failed.' -ForegroundColor Red; exit 1 }

$uf2 = Join-Path $buildDir 'ir_usb_remote.uf2'
if (-not (Test-Path $uf2)) { Write-Host 'Build finished but no .uf2 was produced.' -ForegroundColor Red; exit 1 }

$size = [math]::Round((Get-Item $uf2).Length / 1KB, 1)
Write-Host ''
Write-Host "Built $uf2 ($size KB)" -ForegroundColor Green
Write-Host ''
Write-Host 'To flash: hold BOOTSEL while plugging the board in, then copy that file'
Write-Host 'onto the RPI-RP2 drive that appears. The board reboots as a keyboard.'
if ($UsbVid -eq '0x1209' -and $UsbPid -eq '0x0001') {
    Write-Host ''
    Write-Host 'NOTE: built with the pid.codes TEST USB id. Do not ship this on hardware' -ForegroundColor Yellow
    Write-Host '      you sell -- see docs/branding.md.' -ForegroundColor Yellow
}
