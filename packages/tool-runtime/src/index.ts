/**
 * Public entry point for the framework-neutral tool runtime package.
 *
 * Keeping exports centralized makes it harder for framework adapters to reach internal
 * implementation details and gives us a stable import surface for future persistence
 * adapters and benchmark cases.
 */
export * from './tool-execution';
