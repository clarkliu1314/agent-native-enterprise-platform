# Outbox

Business state and its corresponding outbox event are persisted transactionally. Publication is a separate transport step.

The publisher claims an event, publishes it, and acknowledges it only after transport success. If acknowledgement fails after successful transport, the event may be delivered again. This is intentional at-least-once transport behavior; downstream consumers must be idempotent.

Do not treat an in-memory publish callback as durable acknowledgement.
