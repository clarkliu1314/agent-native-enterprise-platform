# Deployment

The web/API edge is request-oriented and must not be treated as the durable execution engine. Durable state lives in PostgreSQL; background execution and recovery live in an independently deployable worker.

Vercel may host the web/API edge. Worker lifecycle, database connectivity, queue delivery, and recovery leases must remain safe across request and process termination.

Environment variables and production topology should be documented here as the deployment surface is implemented.
