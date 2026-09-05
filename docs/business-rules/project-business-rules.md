# GoLiveBypass Enhanced Business Rules

Status: Draft
Last updated: 2026-09-05
App ID: `golivebypass-enhanced`

## Purpose

This file records product-specific business rules for this AC Tech project.
It does not redefine AC Tech global rules. Global rules remain authoritative
and live in:

```text
<AC_TECH_ROOT>\docs\business-rules\global-business-rules.md
```

## Authority

Project-specific business rules require owner approval before they can be
treated as accepted. Approval must come from `AC-Tech-Pro-Oficial`
(`contas@ac-tech.pro`), operated only by Moacir Costa or Vinicyus Abdala.

No project rule may weaken or conflict with an AC Tech global rule.

## Inherited Global Rules

This project inherits, at minimum:

- `BR-AUTH-001`: approved global identity architecture
- `BR-DATA-001`: app data belongs under `users/{uid}/apps/{appId}`
- `BR-DATA-002`: sensitive and personal data must not persist in plaintext
- `BR-AI-001`: AI tools cannot choose their own user authority
- `BR-LGPD-001`: LGPD register is a release gate
- `BR-DESIGN-001`: design contract is a release gate

## Project Rule Catalog

Use the AC Tech rule ID format:

```text
BR-{APPID}-{NUMBER}
```

Example draft:

```yaml
id: BR-GOLIVEBYPASSENHANCED-001
title: TODO
status: draft
scope: project
owner: AC Tech
approved_by: pending
applies_to:
  - app
  - backend
  - agent
enforcement_layers:
  - tests
  - docs
global_rules_referenced:
  - BR-DATA-002
last_reviewed: TODO
next_review: TODO
```

Write the rule in plain language below the YAML block. Include what must
happen, what is forbidden, and which tests or validators prove compliance.

## Required Before Release

- Every project-specific rule needed for production behavior is recorded here.
- Every accepted rule has owner approval.
- No rule conflicts with AC Tech global rules.
- Tests or validators enforce every rule where practical.
- `docs/privacy/lgpd-project-register.json` references rules that affect
  personal data, legal basis, retention, export, deletion, support, AI,
  analytics, auth, payment, or provider behavior.
