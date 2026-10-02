/*
 * irprobe.c - find the IR output on an unknown receiver board.
 *
 * Built for exactly one job: you have a salvaged sensor board with a handful
 * of unidentified wires, and you want to know which one carries the
 * demodulated IR signal without rewiring and reflashing once per guess.
 *
 * Connect every unknown wire to a different GPIO in the probed range, power
 * the board from 3V3 and GND, open the serial port, and press a button on a
 * remote. The pin that reports bursts is the output.
 *
 * It enumerates as a USB serial port (COMx on Windows), so any terminal will
 * do -- PuTTY, the Arduino IDE monitor, `screen`, whatever. The baud rate is
 * irrelevant over USB CDC.
 *
 * Build: this is a second target in firmware/CMakeLists.txt, so .\build.ps1
 * produces build/irprobe.uf2 alongside the real firmware.
 */
#include <stdio.h>
#include <string.h>
#include "pico/stdlib.h"
#include "ir_decode.h"
#include "ir_protocol.h"

/*
 * GP2..GP9. Eight pins is more than any sensor board has unknown wires, and
 * it deliberately avoids GP0/GP1 (UART) and GP3 is included so a successful
 * find needs no rewiring before flashing the real firmware.
 */
#define PROBE_FIRST 2
#define PROBE_LAST  9
#define NPINS       (PROBE_LAST - PROBE_FIRST + 1)

#define MAXD    320
#define GAP_US  10000u
#define STATUS_INTERVAL_US 2000000u

typedef struct {
    uint16_t us[MAXD];
    uint16_t count;
    bool     level;      /* last sampled level                     */
    bool     started;    /* seen the falling edge that opens a burst */
    uint32_t last_us;
    uint32_t bursts;     /* how many complete bursts this pin produced */
    uint32_t edges;      /* total transitions, including noise         */
} probe_t;

static probe_t g_pin[NPINS];

static void report(int i)
{
    probe_t *p = &g_pin[i];
    const uint gpio = PROBE_FIRST + i;

    p->bursts++;

    ir_frame_t f;
    const ir_decode_result_t r = ir_decode(p->us, p->count, &f);

    printf("GP%-2u  %3u edges  ", gpio, p->count);

    switch (r) {
    case IR_DECODE_FRAME:
        printf("%-10s addr=0x%04lX cmd=0x%02lX  %ub",
               ir_protocol_name(f.protocol),
               (unsigned long)f.address, (unsigned long)f.command, f.nbits);
        if (f.protocol == IR_PROTO_RAW_HASH)
            printf("   (unmodelled protocol, identified by timing)");
        break;
    case IR_DECODE_REPEAT:
        printf("repeat frame (button held)");
        break;
    default:
        printf("not decodable - too short, or not an IR signal");
        break;
    }
    printf("\n");

    /*
     * Print the raw timings for an undecodable burst. If the board turns out
     * to need a different bias or the wire is picking up something else
     * entirely, this is what shows it.
     */
    if (r == IR_DECODE_NONE && p->count >= 4) {
        printf("        timings:");
        for (uint16_t k = 0; k < p->count && k < 24; k++) printf(" %u", p->us[k]);
        if (p->count > 24) printf(" ...");
        printf("\n");
    }
}

static void status(void)
{
    printf("--- idle levels: ");
    for (int i = 0; i < NPINS; i++) {
        const uint gpio = PROBE_FIRST + i;
        printf("GP%u=%c(%lu) ", gpio,
               gpio_get(gpio) ? 'H' : 'L',
               (unsigned long)g_pin[i].bursts);
    }
    printf("\n");
}

int main(void)
{
    stdio_init_all();

    for (int i = 0; i < NPINS; i++) {
        const uint gpio = PROBE_FIRST + i;
        gpio_init(gpio);
        gpio_set_dir(gpio, GPIO_IN);
        /*
         * Pull-up, because a demodulating receiver's output is open-collector
         * on some parts and because an unconnected pin would otherwise float
         * and generate endless phantom edges.
         */
        gpio_pull_up(gpio);
        g_pin[i].level = true;
        g_pin[i].last_us = time_us_32();
    }

    sleep_ms(1500); /* give the host time to open the port */

    printf("\n");
    printf("IR pin probe - watching GP%u..GP%u\n", PROBE_FIRST, PROBE_LAST);
    printf("\n");
    printf("  Power the sensor board from 3V3 and GND, connect each unknown\n");
    printf("  wire to one of those pins, then press a button on a remote.\n");
    printf("\n");
    printf("  A pin idling HIGH with bursts of 60-200 edges is the IR output.\n");
    printf("  A pin idling LOW, or with no bursts, is not.\n");
    printf("\n");
    printf("  DO NOT power the board from VBUS: RP2040 pins are not 5V\n");
    printf("  tolerant and a 5V output would damage them.\n");
    printf("\n");

    uint32_t next_status = time_us_32() + STATUS_INTERVAL_US;

    while (true) {
        const uint32_t now = time_us_32();
        const uint32_t all = gpio_get_all();

        for (int i = 0; i < NPINS; i++) {
            probe_t *p = &g_pin[i];
            const bool lv = (all >> (PROBE_FIRST + i)) & 1u;

            if (lv != p->level) {
                const uint32_t d = now - p->last_us;
                p->level = lv;
                p->last_us = now;
                p->edges++;

                /* A burst opens on a falling edge: the line idles high. */
                if (!p->started) {
                    if (!lv) p->started = true;
                    continue;
                }
                if (p->count < MAXD) p->us[p->count++] = (d > 0xFFFFu) ? 0xFFFFu : (uint16_t)d;
            } else if (p->started && (now - p->last_us) > GAP_US) {
                if (p->count >= 3) report(i);
                p->count = 0;
                p->started = false;
            }
        }

        if ((int32_t)(now - next_status) >= 0) {
            status();
            next_status = now + STATUS_INTERVAL_US;
        }
    }
}
