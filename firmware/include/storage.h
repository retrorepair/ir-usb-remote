/*
 * storage.h - the configuration that survives a power cycle.
 *
 * The whole point of the product is that it works with no PC attached once
 * configured, so bindings live in the last flash sector and are loaded at
 * boot. A CRC guards against a half-finished write (a commit interrupted by
 * unplugging), in which case defaults are loaded rather than garbage being
 * interpreted as keystrokes.
 */
#ifndef STORAGE_H
#define STORAGE_H

#include <stdint.h>
#include <stdbool.h>
#include "wire_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

#define CONFIG_MAGIC   0x52555249u /* "IRUR" little-endian */
#define CONFIG_VERSION 1

typedef struct {
    uint32_t        magic;
    uint16_t        version;
    uint16_t        binding_count;
    wire_settings_t settings;
    uint32_t        pad;      /* keeps bindings 8-byte aligned, explicitly */
    wire_binding_t  bindings[CFG_MAX_BINDINGS];
    uint32_t        crc32;    /* over every byte above */
} ir_config_t;

/* Load from flash, or populate defaults if absent or corrupt. */
void storage_load(ir_config_t *cfg);

/* Overwrite the config sector. Returns false if the readback did not match. */
bool storage_save(const ir_config_t *cfg);

/* Fill cfg with the factory defaults (no bindings, sensible timings). */
void storage_defaults(ir_config_t *cfg);

/* Erase the config sector so the next boot loads defaults. */
bool storage_erase(void);

uint32_t storage_crc32(const void *data, uint32_t len);

#ifdef __cplusplus
}
#endif
#endif /* STORAGE_H */
