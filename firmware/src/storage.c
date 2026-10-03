/*
 * storage.c - config persistence in the last flash sector.
 */
#include <stddef.h>
#include <string.h>
#include "storage.h"
#include "hardware/flash.h"
#include "hardware/sync.h"
#include "pico/platform.h"

/*
 * The config lives in the final 4 KB sector. Linking leaves the program at
 * the start of flash, so the only way these could collide is a firmware image
 * that fills the entire chip, which this one is three orders of magnitude from
 * doing.
 */
#define CONFIG_FLASH_OFFSET (PICO_FLASH_SIZE_BYTES - FLASH_SECTOR_SIZE)
#define CONFIG_XIP_ADDR     ((const uint8_t *)(XIP_BASE + CONFIG_FLASH_OFFSET))

/* Standard CRC-32 (IEEE 802.3), computed bitwise to avoid a 1 KB table. */
uint32_t storage_crc32(const void *data, uint32_t len)
{
    const uint8_t *p = (const uint8_t *)data;
    uint32_t crc = 0xFFFFFFFFu;
    for (uint32_t i = 0; i < len; i++) {
        crc ^= p[i];
        for (int b = 0; b < 8; b++)
            crc = (crc >> 1) ^ (0xEDB88320u & (uint32_t)(-(int32_t)(crc & 1u)));
    }
    return ~crc;
}

void storage_defaults(ir_config_t *cfg)
{
    memset(cfg, 0, sizeof(*cfg));
    cfg->magic         = CONFIG_MAGIC;
    cfg->version       = CONFIG_VERSION;
    cfg->binding_count = 0;

    /*
     * Repeat timing for every action type. A press always fires exactly once;
     * these govern what happens if the button is then held.
     *
     * 400 ms before repeating starts is long enough that a deliberate single
     * press never repeats by accident -- a remote sends several frames per
     * press, and anything much shorter turns a firm press into two steps.
     * 120 ms between repeats is about 8 per second, which scrolls a menu at a
     * readable pace rather than shooting past the item you wanted.
     */
    cfg->settings.repeat_delay_ms    = 400;
    cfg->settings.repeat_rate_ms     = 120;
    /*
     * Ceiling on how long after the last frame a button counts as released.
     * The actual threshold is derived from the repeat interval the remote is
     * measured to use -- 110 ms for NEC, 114 ms for RC5, 45 ms for Sony -- so
     * a fast remote releases sooner than a slow one instead of everything
     * waiting for the worst case. Raise this if a remote with poor reception
     * stutters; it only ever loosens the derived value.
     */
    cfg->settings.release_timeout_ms = 200;
    cfg->settings.led_mode           = 1; /* blink on receive */
    cfg->settings.flags              = SETF_REPORT_UNMAPPED;
}

void storage_load(ir_config_t *cfg)
{
    const ir_config_t *f = (const ir_config_t *)CONFIG_XIP_ADDR;

    if (f->magic == CONFIG_MAGIC &&
        f->version == CONFIG_VERSION &&
        f->binding_count <= CFG_MAX_BINDINGS) {
        const uint32_t want = storage_crc32(f, offsetof(ir_config_t, crc32));
        if (want == f->crc32) {
            memcpy(cfg, f, sizeof(*cfg));
            return;
        }
    }
    storage_defaults(cfg);
}

/*
 * Must not execute from flash: erasing and programming put the QSPI interface
 * into a state where instruction fetches from XIP would fail. The SDK copies
 * functions marked this way into RAM at boot.
 */
static void __not_in_flash_func(flash_write_sector)(const uint8_t *buf)
{
    const uint32_t ints = save_and_disable_interrupts();
    flash_range_erase(CONFIG_FLASH_OFFSET, FLASH_SECTOR_SIZE);
    flash_range_program(CONFIG_FLASH_OFFSET, buf, FLASH_SECTOR_SIZE);
    restore_interrupts(ints);
}

bool storage_save(const ir_config_t *cfg)
{
    /*
     * flash_range_program writes whole pages, so stage the sector in RAM.
     * 4 KB of stack would be reckless on a 264 KB part with USB buffers in
     * play, hence static.
     */
    static uint8_t sector[FLASH_SECTOR_SIZE];

    _Static_assert(sizeof(ir_config_t) <= FLASH_SECTOR_SIZE,
                   "config no longer fits in one flash sector");

    memset(sector, 0xFF, sizeof(sector));
    memcpy(sector, cfg, sizeof(*cfg));

    /* Stamp the CRC into the staged copy, not the caller's. */
    ir_config_t *staged = (ir_config_t *)sector;
    staged->magic   = CONFIG_MAGIC;
    staged->version = CONFIG_VERSION;
    staged->crc32   = storage_crc32(staged, offsetof(ir_config_t, crc32));

    flash_write_sector(sector);

    return memcmp(CONFIG_XIP_ADDR, sector, sizeof(ir_config_t)) == 0;
}

bool storage_erase(void)
{
    static uint8_t blank[FLASH_SECTOR_SIZE];
    memset(blank, 0xFF, sizeof(blank));
    flash_write_sector(blank);
    return memcmp(CONFIG_XIP_ADDR, blank, FLASH_SECTOR_SIZE) == 0;
}
