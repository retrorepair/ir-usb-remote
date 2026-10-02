/*
 * usb_descriptors.h - interface and report numbering shared between the
 * descriptor tables and the code that sends reports.
 */
#ifndef USB_DESCRIPTORS_H
#define USB_DESCRIPTORS_H

/*
 * Three separate HID interfaces rather than one with many report IDs.
 *
 * The keyboard is alone on interface 0 and carries no report ID, which is
 * what makes it a boot-protocol keyboard: BIOS setup screens, boot menus and
 * bootloaders only understand that form, and a remote that cannot navigate
 * them would be a poor showing for a "USB keyboard".
 *
 * Consumer and system controls share interface 1, because putting media keys
 * on the boot keyboard interface would break its boot-protocol compatibility.
 *
 * Interface 2 is the vendor-defined configuration channel.
 */
enum {
    HID_ITF_KEYBOARD = 0,
    HID_ITF_CONTROL  = 1,
    HID_ITF_CONFIG   = 2,
    HID_ITF_COUNT
};

/* Report IDs within HID_ITF_CONTROL. */
enum {
    REPORT_ID_CONSUMER = 1,
    REPORT_ID_SYSTEM   = 2
};

/*
 * System control usages (HID usage page 0x01) exposed as a 3-bit field.
 * A binding stores the usage itself; hid_out.c maps it to the bit.
 */
#define SYSTEM_USAGE_POWER_DOWN 0x81
#define SYSTEM_USAGE_SLEEP      0x82
#define SYSTEM_USAGE_WAKE_UP    0x83

#endif /* USB_DESCRIPTORS_H */
