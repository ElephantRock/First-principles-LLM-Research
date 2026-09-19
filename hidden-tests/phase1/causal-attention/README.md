# Causal Attention hidden-test contract

`contract.json` is the public, versioned interface for the Causal Attention test bundle. It enumerates only documented invariants and the stable bundle identity used in execution evidence.

Because this repository is intentionally public, **hidden fixtures are not committed here**. Production randomized cases, seeds, solution-sensitive assertions, and the private test payload must be delivered to the isolated worker through a private, read-only artifact channel.

Hidden evaluation may test only the documented contract. Failure feedback may expose the invariant and diagnostic category, but not private fixtures or solution code.
