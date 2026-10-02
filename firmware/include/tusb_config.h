/*
 * tusb_config.h - TinyUSB build configuration.
 */
#ifndef TUSB_CONFIG_H
#define TUSB_CONFIG_H

#ifndef CFG_TUSB_MCU
#error "CFG_TUSB_MCU must come from the Pico SDK's TinyUSB integration"
#endif

#define CFG_TUSB_OS            OPT_OS_PICO
#define CFG_TUD_ENABLED        1
#define CFG_TUD_MAX_SPEED      OPT_MODE_FULL_SPEED

/*
 * Root port 0 is a full-speed device port. The argument-less tusb_init() has
 * a static assertion on this being declared, so leaving it out fails the
 * build rather than misbehaving at runtime.
 */
#define CFG_TUSB_RHPORT0_MODE  (OPT_MODE_DEVICE | OPT_MODE_FULL_SPEED)

/* USB DMA on this part cannot reach into arbitrary RAM sections. */
#define CFG_TUSB_MEM_SECTION
#define CFG_TUSB_MEM_ALIGN     __attribute__((aligned(4)))

#define CFG_TUD_ENDPOINT0_SIZE 64

/* Keyboard, consumer/system control, and the configuration channel. */
#define CFG_TUD_HID            3
#define CFG_TUD_CDC            0
#define CFG_TUD_MSC            0
#define CFG_TUD_MIDI           0
#define CFG_TUD_VENDOR         0

/*
 * 64 bytes so a whole wire_packet_t fits in a single transfer. Anything less
 * would fragment configuration packets across reports for no benefit.
 */
#define CFG_TUD_HID_EP_BUFSIZE 64

#endif /* TUSB_CONFIG_H */
