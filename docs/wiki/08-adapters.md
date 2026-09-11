# Adapters

The repository currently contains reference adapters for AgentScope, LangGraph, Eino, and Mastra. They implement the same `AgentFrameworkAdapter` contract over the reference runtime.

These packages are contract scaffolding, not claims of full framework SDK integration. Real SDK integration should be introduced only when it can exercise framework-specific semantics and remain behind the stable runtime contract.

The shared adapter contract test is the compatibility gate.
