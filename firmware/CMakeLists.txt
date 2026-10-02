cmake_minimum_required(VERSION 3.13)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)

# Pulls in the SDK from PICO_SDK_PATH (or fetches it, if PICO_SDK_FETCH_FROM_GIT
# is set). Must come before project().
include(pico_sdk_import.cmake)

project(ir_usb_remote C CXX ASM)
pico_sdk_init()

# ---------------------------------------------------------------------------
# Build options
#
# Everything a board or a product variant needs to change is here, so one
# source tree covers a bare Pico on a breadboard and a branded unit.
# ---------------------------------------------------------------------------
set(IR_GPIO 3 CACHE STRING "GPIO the IR receiver's OUT pin is wired to")
set(IR_LED_GPIO "" CACHE STRING "Status LED GPIO; blank = the board default")
set(USB_VID "0x1209" CACHE STRING "USB vendor id")
set(USB_PID "0x0001" CACHE STRING "USB product id")
set(USB_MANUFACTURER "Open IR" CACHE STRING "USB manufacturer string")
set(USB_PRODUCT "IR USB Remote" CACHE STRING "USB product string")

add_executable(ir_usb_remote
    src/main.c
    src/ir_capture.c
    src/ir_decode.c
    src/ir_protocol.c
    src/keymap.c
    src/storage.c
    src/hid_out.c
    src/config_iface.c
    src/led.c
    src/usb_descriptors.c
)

#
# src/ is on the include path because tusb_config.h lives there rather than in
# include/. That is deliberate: TinyUSB finds tusb_config.h through the
# target's include path, and this one declares a HID-only device with CDC
# switched off. If it sat in the shared include/ directory, the irprobe target
# below would pick it up too and the SDK's USB-serial descriptors would fail
# to compile.
#
target_include_directories(ir_usb_remote PRIVATE
    ${CMAKE_CURRENT_LIST_DIR}/include
    ${CMAKE_CURRENT_LIST_DIR}/src
)

target_compile_definitions(ir_usb_remote PRIVATE
    IR_GPIO=${IR_GPIO}
    USB_VID=${USB_VID}
    USB_PID=${USB_PID}
    USB_MANUFACTURER=\"${USB_MANUFACTURER}\"
    USB_PRODUCT=\"${USB_PRODUCT}\"
    BOARD_NAME=\"${PICO_BOARD}\"
)

if(NOT IR_LED_GPIO STREQUAL "")
    target_compile_definitions(ir_usb_remote PRIVATE IR_LED_GPIO=${IR_LED_GPIO})
endif()

target_compile_options(ir_usb_remote PRIVATE
    -Wall -Wextra -Wno-unused-parameter
)

target_link_libraries(ir_usb_remote PRIVATE
    pico_stdlib
    pico_unique_id       # USB serial number, so two units are distinguishable
    tinyusb_device
    tinyusb_board
    hardware_flash       # persisting bindings
    hardware_sync        # interrupt masking around flash writes
    hardware_watchdog    # the plain-reboot path of CMD_REBOOT
)

# The USB interface belongs to this firmware; the SDK's stdio drivers would
# contend for it (USB) or for pins the user may want (UART).
pico_enable_stdio_usb(ir_usb_remote 0)
pico_enable_stdio_uart(ir_usb_remote 0)

# .uf2 for drag-and-drop flashing, plus .elf/.bin/.map/.dis for debugging.
pico_add_extra_outputs(ir_usb_remote)

# ---------------------------------------------------------------------------
# irprobe - utility for identifying the IR output on a salvaged sensor board.
#
# A separate .uf2 rather than a mode of the real firmware: it needs USB serial
# output, which the receiver deliberately does not have because that interface
# belongs to the HID device.
# ---------------------------------------------------------------------------
option(BUILD_IRPROBE "Build the IR pin-finder utility" ON)

if(BUILD_IRPROBE)
    add_executable(irprobe
        tools/irprobe.c
        src/ir_decode.c
        src/ir_protocol.c
    )
    target_include_directories(irprobe PRIVATE ${CMAKE_CURRENT_LIST_DIR}/include)
    target_compile_options(irprobe PRIVATE -Wall -Wextra -Wno-unused-parameter)
    target_link_libraries(irprobe PRIVATE pico_stdlib)

    # The whole point of this one is a serial console.
    pico_enable_stdio_usb(irprobe 1)
    pico_enable_stdio_uart(irprobe 0)

    pico_add_extra_outputs(irprobe)
endif()
