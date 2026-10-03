/*
 * usb_descriptors.c - USB device, HID report and string descriptors.
 */
#include <string.h>
#include "tusb.h"
#include "pico/unique_id.h"
#include "board_config.h"
#include "usb_descriptors.h"
#include "wire_protocol.h"

/* ------------------------------------------------------------------------- */
/* Device descriptor                                                         */
/* ------------------------------------------------------------------------- */
static const tusb_desc_device_t desc_device = {
    .bLength            = sizeof(tusb_desc_device_t),
    .bDescriptorType    = TUSB_DESC_DEVICE,
    .bcdUSB             = 0x0200,
    /* Class is declared per interface, since this device is a composite. */
    .bDeviceClass       = 0x00,
    .bDeviceSubClass    = 0x00,
    .bDeviceProtocol    = 0x00,
    .bMaxPacketSize0    = CFG_TUD_ENDPOINT0_SIZE,
    .idVendor           = USB_VID,
    .idProduct          = USB_PID,
    .bcdDevice          = (FW_VERSION_MAJOR << 8) | (FW_VERSION_MINOR << 4) |
                           FW_VERSION_PATCH,
    .iManufacturer      = 0x01,
    .iProduct           = 0x02,
    .iSerialNumber      = 0x03,
    .bNumConfigurations = 0x01
};

const uint8_t *tud_descriptor_device_cb(void)
{
    return (const uint8_t *)&desc_device;
}

/* ------------------------------------------------------------------------- */
/* HID report descriptors                                                    */
/* ------------------------------------------------------------------------- */

/* Boot-protocol keyboard: no report ID, so BIOS and bootloaders understand it. */
static const uint8_t desc_hid_keyboard[] = {
    TUD_HID_REPORT_DESC_KEYBOARD()
};

/*
 * Consumer control (media keys) plus a small system control collection.
 *
 * The system part is written out by hand rather than with a TinyUSB macro,
 * because none covers it. Three single-bit flags with five bits of padding,
 * which is unambiguous in a way that an array-style report is not.
 */
static const uint8_t desc_hid_control[] = {
    TUD_HID_REPORT_DESC_CONSUMER(HID_REPORT_ID(REPORT_ID_CONSUMER)),

    0x05, 0x01,              /* Usage Page (Generic Desktop)              */
    0x09, 0x80,              /* Usage (System Control)                    */
    0xA1, 0x01,              /* Collection (Application)                  */
    0x85, REPORT_ID_SYSTEM,  /*   Report ID                               */
    0x09, 0x81,              /*   Usage (System Power Down)               */
    0x09, 0x82,              /*   Usage (System Sleep)                    */
    0x09, 0x83,              /*   Usage (System Wake Up)                  */
    0x15, 0x00,              /*   Logical Minimum (0)                     */
    0x25, 0x01,              /*   Logical Maximum (1)                     */
    0x75, 0x01,              /*   Report Size (1)                         */
    0x95, 0x03,              /*   Report Count (3)                        */
    0x81, 0x02,              /*   Input (Data, Variable, Absolute)        */
    0x75, 0x05,              /*   Report Size (5)   - padding             */
    0x95, 0x01,              /*   Report Count (1)                        */
    0x81, 0x03,              /*   Input (Constant)                        */
    0xC0                     /* End Collection                            */
};

/*
 * Vendor-defined 64-byte in/out channel for the configurator. A vendor usage
 * page is what keeps this reachable from WebHID: the browser refuses to open
 * devices whose collections are claimed as keyboards or mice, so the config
 * channel has to be its own interface outside those pages.
 */
static const uint8_t desc_hid_config[] = {
    TUD_HID_REPORT_DESC_GENERIC_INOUT(WIRE_REPORT_SIZE)
};

const uint8_t *tud_hid_descriptor_report_cb(uint8_t instance)
{
    switch (instance) {
    case HID_ITF_KEYBOARD: return desc_hid_keyboard;
    case HID_ITF_CONTROL:  return desc_hid_control;
    case HID_ITF_CONFIG:   return desc_hid_config;
    default:               return NULL;
    }
}

/* ------------------------------------------------------------------------- */
/* Configuration descriptor                                                  */
/* ------------------------------------------------------------------------- */
#define EPNUM_KB_IN   0x81
#define EPNUM_CTRL_IN 0x82
#define EPNUM_CFG_OUT 0x03
#define EPNUM_CFG_IN  0x83

#define CONFIG_TOTAL_LEN \
    (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN * 2 + TUD_HID_INOUT_DESC_LEN)

static const uint8_t desc_configuration[] = {
    TUD_CONFIG_DESCRIPTOR(1, HID_ITF_COUNT, 0, CONFIG_TOTAL_LEN, 0x00, 100),

    /*
     * 10 ms polling. DO NOT drop this to 1 ms without testing on a MiSTer.
     *
     * Two earlier builds changed it to 1 ms alongside the switch to tapped
     * keys, and both stopped working on a MiSTer while continuing to work on
     * a PC. The tap duration was blamed and lengthened, which did not help --
     * so the polling interval is the remaining suspect and is being held at
     * the value known to work until something measures the difference.
     *
     * The cost is small: at most 10 ms before a press is delivered, against a
     * 25-70 ms IR frame that has to arrive first regardless.
     */
    TUD_HID_DESCRIPTOR(HID_ITF_KEYBOARD, 4, HID_ITF_PROTOCOL_KEYBOARD,
                       sizeof(desc_hid_keyboard), EPNUM_KB_IN,
                       CFG_TUD_HID_EP_BUFSIZE, 10),

    TUD_HID_DESCRIPTOR(HID_ITF_CONTROL, 5, HID_ITF_PROTOCOL_NONE,
                       sizeof(desc_hid_control), EPNUM_CTRL_IN,
                       CFG_TUD_HID_EP_BUFSIZE, 10),

    /* 5 ms, so streaming raw timing captures to the configurator feels live. */
    TUD_HID_INOUT_DESCRIPTOR(HID_ITF_CONFIG, 6, HID_ITF_PROTOCOL_NONE,
                             sizeof(desc_hid_config), EPNUM_CFG_OUT,
                             EPNUM_CFG_IN, CFG_TUD_HID_EP_BUFSIZE, 5),
};

const uint8_t *tud_descriptor_configuration_cb(uint8_t index)
{
    (void)index;
    return desc_configuration;
}

/* ------------------------------------------------------------------------- */
/* String descriptors                                                        */
/* ------------------------------------------------------------------------- */
/*
 * The serial number is derived from the flash chip's unique id, so two
 * receivers on one machine are distinguishable -- the configurator uses it to
 * remember which profile belongs to which unit.
 */
static char s_serial[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES + 1];

static const char *const s_strings[] = {
    NULL,               /* 0: language, handled separately */
    USB_MANUFACTURER,   /* 1 */
    USB_PRODUCT,        /* 2 */
    s_serial,           /* 3 */
    "IR Remote Keyboard",   /* 4 */
    "IR Remote Media Keys", /* 5 */
    "IR Remote Config"      /* 6 */
};

static uint16_t s_desc_str[33];

static void serial_init_once(void)
{
    if (s_serial[0]) return;
    pico_unique_board_id_t id;
    pico_get_unique_board_id(&id);
    static const char hex[] = "0123456789ABCDEF";
    for (int i = 0; i < PICO_UNIQUE_BOARD_ID_SIZE_BYTES; i++) {
        s_serial[i * 2]     = hex[(id.id[i] >> 4) & 0xF];
        s_serial[i * 2 + 1] = hex[id.id[i] & 0xF];
    }
    s_serial[2 * PICO_UNIQUE_BOARD_ID_SIZE_BYTES] = '\0';
}

const uint16_t *tud_descriptor_string_cb(uint8_t index, uint16_t langid)
{
    (void)langid;
    uint8_t chars;

    if (index == 0) {
        s_desc_str[1] = 0x0409; /* English (US) */
        chars = 1;
    } else {
        if (index >= TU_ARRAY_SIZE(s_strings)) return NULL;
        serial_init_once();

        const char *str = s_strings[index];
        if (!str) return NULL;

        size_t len = strlen(str);
        if (len > TU_ARRAY_SIZE(s_desc_str) - 1) len = TU_ARRAY_SIZE(s_desc_str) - 1;
        for (size_t i = 0; i < len; i++) s_desc_str[1 + i] = (uint16_t)str[i];
        chars = (uint8_t)len;
    }

    /* First 16-bit word is the length in bytes and the descriptor type. */
    s_desc_str[0] = (uint16_t)((TUSB_DESC_STRING << 8) | (2 * chars + 2));
    return s_desc_str;
}
