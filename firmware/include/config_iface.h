/*
 * config_iface.h - the configuration channel the desktop app talks to.
 */
#ifndef CONFIG_IFACE_H
#define CONFIG_IFACE_H

#include <stdint.h>
#include <stdbool.h>
#include "storage.h"
#include "ir_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

void config_iface_init(ir_config_t *cfg);

/* Drains the outbound queue and runs deferred work. Call every loop pass. */
void config_iface_task(void);

/* Tell the host about a frame. Honours the current mode and report settings. */
void config_iface_report_ir(const ir_frame_t *f, uint64_t key, int binding_idx,
                            uint16_t raw_count, uint16_t repeats,
                            uint32_t frame_seq);

/* Stream raw timings, when the host has asked for them. */
void config_iface_report_raw(const uint16_t *us, uint16_t n, uint32_t frame_seq);

bool config_iface_raw_enabled(void);

/* Statistics shown in the app's diagnostics panel. */
void config_iface_note_frame(ir_protocol_t p, bool unknown);

#ifdef __cplusplus
}
#endif
#endif /* CONFIG_IFACE_H */
