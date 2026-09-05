# GoLiveBypass Enhanced Data Protection Plan

Status: Draft
Last updated: 2026-09-05
App ID: `golivebypass-enhanced`

## Purpose

This file records how this AC Tech project implements the global data
protection, field-level encryption, key-management, and plaintext rejection
standards.

Canonical sources:

- `<AC_TECH_ROOT>\standards\data-protection-encryption-standard.md`
- `<AC_TECH_ROOT>\standards\application-key-management-standard.md`
- `<AC_TECH_ROOT>\security\sensitive-data-policy.json`
- `<AC_TECH_ROOT>\security\field-level-encryption-policy.json`
- `<AC_TECH_ROOT>\security\application-key-management-policy.json`
- `<AC_TECH_ROOT>\docs\business-rules\global-business-rules.md`
- `docs/privacy/lgpd-project-register.json`

## Data Surfaces

List every surface that can receive, store, display, export, transmit, or log
personal or sensitive data.

Default placement rule: prioritize a local database when the workflow can stay
local and still prove encryption or protected storage, retention/deletion,
export, backup, incident, and support-rights behavior. Use Firebase only when
local storage cannot satisfy the product need, and record the reason in this
plan and `docs/privacy/lgpd-project-register.json`.

| Surface | Data categories | Storage path/provider | Protection | Tests |
| --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | TODO |

## Database Placement Decisions

| Workflow | Local database viable? | Firebase or provider needed? | Reason | Evidence |
| --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | TODO |

## Protected Field Map

Every persisted personal-data field must use ciphertext, hash, token reference,
or keyed blind index. Plaintext personal fields are forbidden.

| Plain-language value | Forbidden plaintext names | Approved stored fields | Lookup needed | Key/version source | Tests |
| --- | --- | --- | --- | --- | --- |
| User email | `email` | `contactCiphertext`, `emailBlindIndex` | yes | TODO | TODO |
| User display/profile name | `name`, `displayName` | `profileCiphertext` | no | TODO | TODO |

## Key Management

Default AC Tech policy:

- Cloud KMS key ring: `ac-tech-app-crypto`
- Location: `southamerica-east1`
- Key naming pattern: `field-encryption-{environment}-golivebypass-enhanced`
- Secret naming pattern: `ac-tech-{environment}-golivebypass-enhanced-{purpose}`
- No UI direct access to KMS or Secret Manager
- No plaintext data encryption key storage

Project decisions:

| Purpose | Environment | KMS key or secret handle | Service account | Rotation plan | Status |
| --- | --- | --- | --- | --- | --- |
| TODO | TODO | TODO | TODO | TODO | draft |

## Firestore Paths

Approved client-owned app data roots:

```text
users/{uid}/apps/golivebypass-enhanced/workspace/...
users/{uid}/apps/golivebypass-enhanced/clientState/...
```

These paths may not store plaintext personal data. If a document contains
personal data, the app data-protection layer must convert it to an approved
representation before persistence.

Backend-owned paths:

```text
users/{uid}/apps/golivebypass-enhanced/subscriptions/...
users/{uid}/apps/golivebypass-enhanced/entitlements/...
users/{uid}/apps/golivebypass-enhanced/ai/...
users/{uid}/apps/golivebypass-enhanced/admin/...
users/{uid}/apps/golivebypass-enhanced/security/...
users/{uid}/apps/golivebypass-enhanced/audit/...
```

## Required Tests

Before release-readiness claims, this project must prove:

- plaintext personal field names are rejected before persistence
- known personal-data fixture values fail persistence tests when unprotected
- ciphertext/hash/token/blind-index fields are accepted only through the
  approved data-protection layer
- encryption metadata includes algorithm, key version, authenticated-data
  version, and timestamp
- blind indexes are keyed, versioned, non-reversible, not user-visible, and not
  model-visible
- logs, errors, screenshots, QA reports, model-visible output, and exports
  redact or omit plaintext personal data
- UI/presentation code cannot import raw Firestore, KMS, Secret Manager,
  provider APIs, or encryption internals directly
- account deletion and rights-request flows do not persist plaintext email or
  phone values

## Release Blockers

This project is not privacy, security, production, or release ready while any
of the following are true:

- this plan is missing, stale, or placeholder-only
- `docs/privacy/lgpd-project-register.json` is missing or placeholder-only
- plaintext personal data can be persisted
- Firebase is used without an evidence-backed reason that local storage is
  insufficient
- local database persistence lacks encryption/protected-storage, export,
  deletion, retention, backup, or log-redaction evidence
- encryption/key-management tests are missing
- Secret Manager/KMS/IAM/App Check evidence is missing for production flows
- data export, deletion, correction, incident, or support paths are not
  represented in the LGPD register
