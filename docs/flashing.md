# Flashing the firmware

## From a release build

1. Hold the **BOOTSEL** button on the RP2040 board.
2. Plug it into USB while still holding BOOTSEL.
3. Release. A drive called **RPI-RP2** appears.
4. Copy `ir_usb_remote.uf2` onto it.

The drive disappears and the board reboots as a keyboard. That is the whole
process — there is no driver, no installer and no bootloader to flash first.

### Updating later, without the BOOTSEL button

Once the firmware is running, the configurator can put the board into update
mode for you: **Receiver → Firmware update mode**. The `RPI-RP2` drive appears
as above. This matters for a sealed product where BOOTSEL is not reachable.

## Building it yourself

### Prerequisites

| Tool | Why | Install |
|---|---|---|
| CMake | build system | `winget install Kitware.CMake` |
| Ninja | build system | `winget install Ninja-build.Ninja` |
| Arm GNU Toolchain | cross compiler | see below |
| Python 3 | the SDK's boot-stage-2 padding script | `winget install Python.Python.3.12 --scope user` |
| A host GCC | the SDK builds `picotool` natively to make the .uf2 | `winget install BrechtSanders.WinLibs.POSIX.UCRT` |
| Pico SDK 2.1.1 | — | `git clone -b 2.1.1 https://github.com/raspberrypi/pico-sdk "$env:USERPROFILE\pico-sdk"` then `git -C "$env:USERPROFILE\pico-sdk" submodule update --init --depth 1 lib/tinyusb` |

The Arm toolchain's winget package runs an installer that needs elevation and
is easy to dismiss by accident. The portable zip avoids that entirely:

```powershell
$url = 'https://developer.arm.com/-/media/Files/downloads/gnu/14.2.rel1/binrel/arm-gnu-toolchain-14.2.rel1-mingw-w64-i686-arm-none-eabi.zip'
curl.exe -L -o "$env:TEMP\arm.zip" $url
Expand-Archive "$env:TEMP\arm.zip" -DestinationPath "$env:USERPROFILE\arm-toolchain"
```

`build.ps1` looks in `%USERPROFILE%\arm-toolchain` as well as Program Files,
so no PATH changes are needed.

### Build

```powershell
cd firmware
.\build.ps1 -Test
```

`-Test` compiles and runs the decoder tests on your PC first, so a broken
decoder fails before you flash anything. Output lands in
`firmware/build/ir_usb_remote.uf2`.

### Build options

```powershell
.\build.ps1 -Board pico_w          # any PICO_BOARD the SDK knows
.\build.ps1 -IrGpio 2              # receiver on a different pin
.\build.ps1 -Vid 0x1209 -Pid 0xC0DE   # your own USB id, see branding.md
.\build.ps1 -Clean                 # discard the previous build directory
.\build.ps1 -BuildType Debug
```

Override tool locations with `CMAKE_EXE`, `NINJA_EXE`, `PYTHON_EXE`,
`HOST_GCC` and `PICO_SDK_PATH` if yours live somewhere unusual.

### Expected output

A clean build reports roughly:

```
   text    data     bss     dec     hex
  31216       0   16432   47648    ba20
```

about 31 KB of flash and 16 KB of RAM, out of 2 MB and 264 KB. There is a lot
of headroom for more bindings or protocols.

## Troubleshooting

**`No CMAKE_C_COMPILER could be found` while building picotool.** The SDK
builds `picotool` as a *host* program to generate the .uf2, so a native
compiler must be on PATH as well as the cross compiler. Install the WinLibs
package above; `build.ps1` then finds and uses it automatically.

**`Could NOT find Python3`.** The SDK pads and checksums the second-stage
bootloader with a Python script. Install Python and rebuild.

**CMake 4 rejects the SDK.** `build.ps1` passes
`-DCMAKE_POLICY_VERSION_MINIMUM=3.5`, which is what lets CMake 4.x configure
the SDK's older CMake files. If you configure by hand, pass it yourself.

**The board enumerates but nothing happens.** Check Diagnostics in the
configurator — see [hardware.md](hardware.md) for what the LED tells you.
