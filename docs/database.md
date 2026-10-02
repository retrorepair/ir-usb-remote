# The remote database

## What is bundled, and why that one

The app ships a compiled subset of
**[Flipper-IRDB](https://github.com/Lucaslhm/Flipper-IRDB)**, which is
**CC0-1.0** — a public domain dedication with no conditions at all. That is
the reason it was chosen: it can be redistributed inside a commercial product
without attribution requirements, licence files or restrictions.

Current build: **5,199 remotes, 152,600 buttons, 1,057 distinct addresses**,
about 3.1 MB.

## What was deliberately left out

### One For All setup codes

The original brief asked for One For All codes. Those are **UEI's proprietary
database** and are not licensed for redistribution, so shipping them inside a
product for sale is not something that could be done safely.

The feature they were wanted for — recognising a commercial remote — is
delivered a different way, and arguably a better one: the firmware decodes at
protocol level, so a remote is identified by what it actually transmits rather
than by a lookup code the user has to find and type in. Nothing has to be
known about a remote in advance for it to work.

### probonopd/irdb

A well-known alternative, but the GitHub licence API reports `NOASSERTION` —
no clearly declared licence. It is therefore **not bundled**. The importer can
read it if you have your own reason to, but nothing in the shipped app depends
on it.

## How identification works

Every button on a remote shares one protocol and one address; only the command
differs. So pressing a single button yields a `(protocol, address)` pair, and
the index maps that pair to candidate remotes.

It narrows thousands of remotes to a handful but cannot be exact — many
manufacturers ship dozens of models on one address. The UI presents matches as
suggestions to confirm, never as a definitive answer, and the layout stays
fully editable afterwards.

Candidates are capped at 40 per address, sorted by button count: an address
like NEC `0x04` is shared by hundreds of LG remotes, and the entries with the
most buttons are the most likely to be a complete layout.

## Protocol field mapping

Flipper stores addresses and commands as little-endian byte arrays whose width
and meaning depend on the protocol. The importer converts them to exactly what
this firmware reports for the same transmission:

| Flipper protocol | Our id | Address | Command |
|---|---|---|---|
| NEC | 1 | `b[0]` | `c[0]` |
| NECext | 2 | `b[0] \| b[1]<<8` | `c[0]` |
| RC5 | 3 | `b[0]` | `c[0]` |
| RC5X | 4 | `b[0]` | `c[0]` |
| RC6 | 5 | `b[0]` | `c[0]` |
| SIRC / SIRC15 / SIRC20 | 7 / 8 / 9 | `b[0] \| b[1]<<8` | `c[0]` |
| Samsung32 | 10 | `b[0] \| b[0]<<8` | `c[0]` |

Samsung is the one that needs explaining: the remote transmits its address
byte **twice** and the firmware reports both, so a database address of `0x0E`
corresponds to a decoded address of `0x0E0E`.

NECext commands store the inverse in the second byte, so only the first is the
command.

### Protocols deliberately not mapped

Kaseikyo, RCA, Pioneer and the NEC42 variants store their fields in a layout
that does not line up with how the firmware packs identity. A computed key
would be wrong in a way the user could not see, so those entries are skipped
rather than guessed at. Remotes using them still work — they are learned by
pressing buttons, which is always available.

## Button name canonicalisation

Contributors name buttons inconsistently: `Vol_up`, `VOL+`, `Volume_Up`. The
importer maps them onto one vocabulary (`vol_up`, `ok`, `num_7`, …), which is
what allows a keymap preset to fill itself in automatically once a remote is
chosen. About 46% of buttons are recognised this way; the rest keep their
original name and are simply left for the user to map.

## Rebuilding

```bash
git clone --depth 1 https://github.com/Lucaslhm/Flipper-IRDB.git \
  tools/db-build/sources/Flipper-IRDB
cd app && npm run db:build
```

Output goes to `app/resources/db/`, which Vite copies into the bundle, so the
renderer can fetch `./db/index.json` in both development and a packaged build.

The generated output **is committed**, at about 3 MB. The app cannot function
without it, so a fresh clone should build and run without first downloading a
42 MB third-party repository. It is marked `linguist-generated` in
`.gitattributes` so it stays out of diffs and language statistics.

The source clone (`tools/db-build/sources/`) is gitignored — it is upstream's
to version, not ours.

### Shape of the output

```
db/index.json        metadata for every remote + a protocol:address lookup
db/buttons/NN.json   button-to-command maps, 32 shards
```

The index is loaded once at startup; a shard is fetched only when the user
picks a remote from it. That keeps startup fast without a database engine.

## Numbers from the last build

```
scanning 8901 .ir files

remotes:          5199
buttons:          152600 (69876 recognised by name)
distinct addrs:   1057
skipped, no usable parsed signals: 3610
skipped, protocol not identity-mappable: 92
files mixing devices (dominant kept):  280
```

The 3,610 skipped files contain only `raw`-type signals — captured waveforms
with no decoded protocol — which carry no address to match on. Those remotes
are still fully usable through learning.
