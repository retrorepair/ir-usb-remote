/*
 * board_config.h - compile-time hardware and identity configuration.
 *
 * Every value here can be overridden from the CMake command line, e.g.
 *   cmake -DIR_GPIO=2 -DUSB_VID=0x1209 -DUSB_PID=0xC001 ..
 * so one source tree can produce firmware for a bare Pico, a Pico W, or a
 * custom board, without edits.
 */
#ifndef BOARD_CONFIG_H
#define BOARD_CONFIG_H

/* ------------------------------------------------------------------------- */
/* Pins                                                                      */
/* ------------------------------------------------------------------------- */
/*
 * GPIO the IR receiver's OUT pin is wired to. A TSOP38238 / TSOP4838 /
 * VS1838B style demodulating receiver idles HIGH and pulls LOW during a
 * 38 kHz burst, so the firmware treats a falling edge as the start of a mark.
 */
#ifndef IR_GPIO
#define IR_GPIO 3
#endif

/*
 * Status LED. PICO_DEFAULT_LED_PIN is 25 on a Pico. On a Pico W the LED hangs
 * off the wireless chip rather than a GPIO, so LED support compiles out there
 * unless the board file defines a usable pin.
 */
#ifndef IR_LED_GPIO
#ifdef PICO_DEFAULT_LED_PIN
#define IR_LED_GPIO PICO_DEFAULT_LED_PIN
#else
#define IR_LED_GPIO -1
#endif
#endif

/* ------------------------------------------------------------------------- */
/* USB identity                                                              */
/* ------------------------------------------------------------------------- */
/*
 * DEFAULT IS A DEVELOPMENT-ONLY ID. 0x1209/0x0001 is the pid.codes "test"
 * pair, explicitly not for distribution. Before selling hardware you must
 * supply your own allocation -- see docs/branding.md for the three legitimate
 * routes. The configurator reads the VID/PID back from the device and warns
 * when it sees the test pair, so this cannot ship unnoticed.
 */
#ifndef USB_VID
#define USB_VID 0x1209
#endif
#ifndef USB_PID
#define USB_PID 0x0001
#endif

#ifndef USB_MANUFACTURER
#define USB_MANUFACTURER "Open IR"
#endif
#ifndef USB_PRODUCT
#define USB_PRODUCT "IR USB Remote"
#endif

/* Reported to the configurator so support can tell builds apart. */
#ifndef BOARD_NAME
#define BOARD_NAME "pico"
#endif

/* ------------------------------------------------------------------------- */
/* Capture tuning                                                            */
/* ------------------------------------------------------------------------- */
/*
 * A burst is considered complete after this much idle time. The longest
 * intra-frame space in any protocol modelled here is the NEC header's 4.5 ms,
 * and the shortest inter-frame gap on a held key is around 20 ms (RC5/RC6
 * resend every ~45 ms, NEC ditto frames every 108 ms), so 10 ms separates
 * frames cleanly without ever splitting one.
 */
#ifndef IR_FRAME_GAP_US
#define IR_FRAME_GAP_US 10000u
#endif

/*
 * Durations captured per burst. The longest frame modelled is 48-bit Kaseikyo:
 * 2 header + 96 bit + 1 trailing = 99. 320 leaves generous room for unknown
 * protocols handled by the raw hash, which is what makes the receiver
 * universal rather than limited to the decoders below.
 */
#ifndef IR_MAX_DURATIONS
#define IR_MAX_DURATIONS 320
#endif

/*
 * Shortest burst worth handing to the decoders. Three, because a NEC "ditto"
 * frame really is three durations (9 ms mark, 2.25 ms space, 560 us mark) and
 * a higher floor here silently discards every held-button repeat.
 */
#ifndef IR_MIN_DURATIONS
#define IR_MIN_DURATIONS 3
#endif

/*
 * Noise rejection lives here instead: a burst this short is never used to
 * invent an identity via the raw timing hash. Protocol decoders validate
 * their own structure and length, so they are safe with short bursts; the
 * hash accepts anything, so it needs the floor.
 */
#ifndef IR_MIN_HASH_DURATIONS
#define IR_MIN_HASH_DURATIONS 8
#endif

#endif /* BOARD_CONFIG_H */
