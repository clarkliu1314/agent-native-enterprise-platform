# Tool Permission

Tool execution is default-deny. A tool request must satisfy the configured policy before any externally effectful invocation is attempted.

Permission is independent from idempotency: authorization answers whether an operation is allowed; idempotency answers whether the same logical operation has already produced a result.

Recovery never bypasses this boundary.
