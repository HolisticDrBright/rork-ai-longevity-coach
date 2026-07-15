# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for the AI Longevity
Pro platform evolution. Each ADR captures one significant, hard-to-reverse
decision: its context, the choice, and its consequences.

Format: lightweight [MADR](https://adr.github.io/madr/)-style. One file per
decision, numbered sequentially, immutable once **Accepted** (supersede with a
new ADR rather than editing).

## Status values
`Proposed` · `Accepted` · `Superseded by ADR-NNNN` · `Deprecated`

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](./0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](./0002-capture-baseline-schema-before-migrations.md) | Capture the live schema before writing migrations | Proposed |
| [0003](./0003-centralized-authorization-and-org-model.md) | Centralized authorization + organization-first tenancy | Proposed |

New ADRs expected during Phase 1: move secrets/AI behind the server;
device-storage cipher replacement; audit-event schema; desktop↔backend
schema-sharing mechanism (tRPC types vs. shared Zod package).
