# 1. Record architecture decisions

Date: 2026-07-15
Status: Accepted

## Context

The repository is evolving from a single Expo app + ad-hoc clinic backend into
a multi-tenant clinical intelligence platform with a new desktop practitioner
app. Several decisions in this evolution are load-bearing and hard to reverse
(tenancy model, authorization strategy, how the database schema is managed, how
secrets and AI calls are handled). Phase 0 surfaced that key past decisions
were **undocumented** — most importantly, the database schema and its RLS
posture exist only in a remote project, with an empty migration file and a
design doc that disagrees with the code.

## Decision

We will record significant architecture decisions as ADRs in
`docs/architecture-decisions/`, numbered and immutable once accepted. A
decision is "significant" if it is costly to reverse, affects security or data
integrity, or constrains multiple future slices.

## Consequences

- New contributors (and future audit passes) can see *why* a structure exists,
  not just *what* it is.
- Decisions that turn out wrong are superseded by a new ADR, preserving history.
- Small, reversible choices do **not** need an ADR — this is not process for
  its own sake.
