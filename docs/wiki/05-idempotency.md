# Idempotency

An idempotency key identifies one logical external effect. Worker attempts are not new logical effects.

If an operation has a committed result, replay returns that result without invoking the external system again. If the external outcome is ambiguous, recovery retries with the original key so the external tool can deduplicate the effect.

Idempotency is a correctness boundary, not merely an optimization.
