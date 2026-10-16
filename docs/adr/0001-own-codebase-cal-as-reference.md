# ADR-0001: Own codebase, Cal.com as reference only

- Status: Accepted
- Date: 2026-10-16

## Context
Cal.com went closed source in April 2026. The community fork (Cal.diy) is open
but dropped teams, routing forms, workflows, SSO and API v1. Forking would give
hundreds of ready features and a similar stack (Next.js, Prisma, TypeScript monorepo).

## Decision
Write the codebase from scratch. Use Cal.com / Cal.diy source code only as a
reference for studying solutions (slot calculation, timezones, Google sync).

## Reasons
- The features users miss most lived in Cal.com's commercial "enterprise" part
  and were removed from Cal.diy; they would have to be written from scratch anyway.
- A fork would be "yet another Cal.diy fork", with no reason for users to switch.
- The codebase was built by a company with dozens of engineers over 5 years;
  maintaining it alone is not viable, and any security issues would be inherited.
- An original architecture is easier to evolve, reason about and defend.

## Consequences
- The MVP takes longer, but every technical decision belongs to this project and is documented.
- Small pieces may be reused only if the license allows it, always with attribution.
- Contributing a few PRs to Cal.diy early is encouraged to learn the domain.
