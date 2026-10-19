# Portable helper contracts

These helpers import no repository models, configuration, filesystem, or cache
policy. Build with `npm run build`; verify their contracts with
`node --test dist/tests/utils.test.js`.

## Framed fingerprints

`fingerprint(parts)` hashes the UTF-8 marker `zmem-framed-v1\0`, followed by an
unsigned 64-bit big-endian byte length and the bytes of each component. Ordering,
empty components, and component boundaries matter. Core supplies normalized
semantic fields; the helper does not decide which fields affect identity.
Node's SHA-256 implementation provides the hash. Build-artifact identification
is another use for this contract.

## Shared pending work

`createSingleFlight({maxPending}).run(key, work)` shares pending success or failure
for one key, bounds distinct pending keys, removes settled work, and performs no
automatic retry. It is in-process coalescing, not a durable or cross-process
lock. Callback effects are not undone, and a later explicit call can execute
again. Duplicate HTTP-fetch suppression is another use.

## Immutable plain data

`freezeData(value)` recursively freezes plain data in place, preserving shared
references and cycles. It rejects non-data objects such as Map or Date rather
than claiming that Object.freeze protects their mutable internals. It performs
no cloning, persistence, or semantic validation. Its return type remains the
input type, so callers still need appropriate readonly public contracts.
Protecting cached API JSON from caller mutation is another use.

## Standard LRU reuse

Use `lru-cache` directly for bounded ordinary value residency. Its count/size
bounds and disposal behavior are verified with plain values. Persistent segment
eviction, dependency leases, and process ownership belong to core, not utils.
