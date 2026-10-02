/*
 * ir_protocol.c - protocol names and button-identity construction.
 */
#include "ir_protocol.h"

const char *ir_protocol_name(ir_protocol_t p)
{
    switch (p) {
    case IR_PROTO_NONE:      return "none";
    case IR_PROTO_NEC:       return "NEC";
    case IR_PROTO_NEC_EXT:   return "NECext";
    case IR_PROTO_RC5:       return "RC5";
    case IR_PROTO_RC5X:      return "RC5X";
    case IR_PROTO_RC6_0:     return "RC6";
    case IR_PROTO_RC6_6A:    return "RC6-6A";
    case IR_PROTO_SONY12:    return "SIRC12";
    case IR_PROTO_SONY15:    return "SIRC15";
    case IR_PROTO_SONY20:    return "SIRC20";
    case IR_PROTO_SAMSUNG32: return "Samsung32";
    case IR_PROTO_KASEIKYO:  return "Kaseikyo";
    case IR_PROTO_JVC:       return "JVC";
    case IR_PROTO_SHARP:     return "Sharp";
    case IR_PROTO_DENON:     return "Denon";
    case IR_PROTO_RCA:       return "RCA";
    case IR_PROTO_RAW_HASH:  return "Raw";
    default:                 return "?";
    }
}

/*
 * Command bits that alternate between presses of the same physical button and
 * therefore must not contribute to identity.
 *
 * Every protocol this build decodes is currently zero, and that is a result
 * rather than an omission: each decoder strips its own toggle structurally
 * before returning, which is the only way to do it correctly when the toggle
 * is not a command bit at all.
 *
 *   RC5 / RC5X   bit 2 of the frame is the toggle; decode_rc5() never folds
 *                it into the command, it only raises IR_FLAG_TOGGLE.
 *   RC6 mode 0   the double-width trailer bit is the toggle; likewise kept out.
 *   RC6-6A       the toggle sits in payload bit 15, i.e. inside the address
 *                field, so decode_rc6() masks it there.
 *   NEC family   ditto frames carry no payload, so there is nothing to mask.
 *
 * The table exists because Sharp and Denon (reserved ids, not yet decoded)
 * invert payload bits between frames, and because a specific remote can always
 * surprise us -- hence the user-supplied extra mask in ir_frame_key(), which
 * the configurator sets when learning observes one button emitting two codes.
 */
uint32_t ir_protocol_toggle_mask(ir_protocol_t p)
{
    switch (p) {
    case IR_PROTO_SHARP: return 0u; /* handled when that decoder lands */
    case IR_PROTO_DENON: return 0u;
    default:             return 0u;
    }
}

uint64_t ir_frame_key(const ir_frame_t *f, uint32_t extra_cmd_mask)
{
    const uint32_t mask = ir_protocol_toggle_mask(f->protocol) | extra_cmd_mask;
    return IR_KEY(f->protocol, f->address, f->command & ~mask);
}
