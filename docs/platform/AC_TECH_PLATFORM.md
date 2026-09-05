# AC Tech Platform Contract

Copy this file into an AC Tech app repo under `docs/platform/` and fill the
project-specific fields.

Default bootstrap may refresh this repository's lock file without replacing
this prose file. Agents must preserve product-specific notes here unless
`--force` is explicitly owner-approved.

## Adopted Standard

- Canonical standard repo: `<AC_TECH_ROOT>`
- Contract file: `contracts/ac-tech-platform.contract.json`
- Adopted contract version: `0.1`
- Administrative payload encryption: `age` with current post-quantum hybrid
  ML-KEM-768 + X25519 public recipients for document payloads; SOPS plus age
  only for structured config/secrets
- LGPD privacy governance: `docs/privacy/lgpd-project-register.json` is the
  project ROPA/privacy register and must be kept current for user data,
  provider, AI, auth, payment, support, analytics, and release-readiness work
- Project business rules: `docs/business-rules/project-business-rules.md`
  records project-specific rules and owner approvals
- Project data protection plan: `docs/security/data-protection-plan.md`
  records protected fields, encryption/key-management decisions, tests, and
  release blockers
- Field-level encryption policy:
  `security/field-level-encryption-policy.json`; plaintext personal data must
  be rejected before persistence
- Application key management: Cloud KMS envelope encryption in
  `southamerica-east1`, Secret Manager for version-pinned secrets and
  blind-index keys, and backend-only key access per
  `security/application-key-management-policy.json`
- Workstation baseline: `governance_core` from
  `<AC_TECH_ROOT>\tooling\workstation-tooling-policy.json`
- Agent-client certification:
  `tooling/workstation-tooling-policy.json#agent_client_certification`; Codex,
  Windsurf, Antigravity, and Claude Code must receive equivalent preflight,
  rule/instruction, and skill surfaces before workstation or project
  certification claims. `scripts/Sync-AcTechAgentClientSurfaces.ps1` keeps
  generated IDE files normalized from canonical AC Tech sources.
- MCP/provider gateway policy:
  `security/mcp-provider-gateway-policy.json`; provider tools must use
  read-only inventory and dry-run plans before owner-confirmed apply mode
- Firebase project ID: `ac-tech-data`
- Firestore database ID: `ac-tech-data`
- Firestore edition: Enterprise
- Database placement: local database first; Firebase only when local storage
  cannot satisfy the workflow, authority, sync, support, audit, or provider
  requirement
- Global account root: `users/{uid}`
- Per-app user root: `users/{uid}/apps/{appId}/...`

## App Registration

- App ID: `golivebypass-enhanced`
- Product name: `GoLiveBypass Enhanced`
- Runtime platforms: `TODO`
- Backend codebase name: `TODO`
- Storage paths, if any: `TODO`
- Public hosted origins, if any: `TODO`
- App Check providers: `TODO`

## Required Architecture

The app must keep database, Functions, provider API, and AI tool communication
outside the interface layer.

Required boundary:

```text
presentation -> application -> domain contracts -> infrastructure -> Firebase/Functions/provider APIs
```

## Required Firebase Shape

Project data must prefer local databases when the workflow can stay local and
still prove encryption or protected storage, retention/deletion, export,
backup, incident, and support-rights behavior. Use Firebase only when local
storage cannot satisfy the product need, and record the reason in
`docs/privacy/lgpd-project-register.json` and
`docs/security/data-protection-plan.md`.

All application adapters explicitly target the one canonical production
database `projects/ac-tech-data/databases/ac-tech-data`. Temporary restore-drill
databases are operational quarantine under the canonical AC Tech recovery
standard: they are never application-routable and never change the app's
database ID.

Client-owned app data must live under:

```text
users/{uid}/apps/{appId}/workspace/...
users/{uid}/apps/{appId}/clientState/...
```

Backend-owned app data must live under explicit backend-owned buckets such as:

```text
users/{uid}/apps/{appId}/subscriptions/...
users/{uid}/apps/{appId}/entitlements/...
users/{uid}/apps/{appId}/ai/...
users/{uid}/apps/{appId}/admin/...
users/{uid}/apps/{appId}/security/...
users/{uid}/apps/{appId}/audit/...
```

## Required Proof Before Release

- Firestore owner/cross-user/unauthenticated/server-only rules tests
- Storage owner/cross-user/unauthenticated/path/content rules tests, if Storage
  is used
- callable auth/App Check/role/cross-user tests
- live IAM readback proving every App Check-enforced function runtime service
  account has `roles/firebaseappcheck.tokenVerifier`
- for an app using Google Play subscriptions, live readback proving the exact
  documented Google Play RTDN publisher has only `roles/pubsub.publisher` on a
  dedicated per-app Pub/Sub topic, with no project-, folder-, or
  organization-level grant
- for an app using Google Play subscriptions, an authenticated Eventarc
  consumer with a dedicated runtime identity and `roles/run.invoker` only on
  its target Cloud Run service
- a Google Play `testNotification` that succeeds through the deployed consumer
  without querying purchase state or changing entitlements
- AI hostile-argument tests for every model-exposed database read tool
- AI confirmation/audit tests for every model-exposed mutation tool
- architecture import-boundary tests
- workstation task gates for the touched surface:
  `tools:check:strict`, plus provider/mobile/SOPS gates when relevant
- agent-client certification evidence from
  `scripts/install_ide_preflight_hooks.ps1` for Codex, Windsurf, Antigravity,
  and Claude Code when workstation/project setup, hooks, rules, skills,
  preflight, or agent instructions change, plus
  `scripts/Sync-AcTechAgentClientSurfaces.ps1` evidence when permanent
  synchronization is part of workstation setup
- MCP/provider gateway policy validation with `npm run mcp:validate` when
  provider gateway tools, MCP servers, provider access, or tool-calling policy
  changes
- staged plaintext sensitive-data scan
- tracked plaintext sensitive-data audit before release readiness claims
- LGPD project register at `docs/privacy/lgpd-project-register.json` with
  controller/operator mapping, ROPA processing activities, legal basis for
  every activity, retention/deletion rules for every data category, data
  subject rights path, incident owner/deadlines, RIPD decision, international
  transfer assessment, and owner review
- field-level encryption or hashing tests for highly sensitive stored data
- plaintext personal-data rejection tests for every user/client data path
- encrypted, hashed, tokenized, or blind-indexed persistence tests for every
  personal-data field
- project business-rule catalog at
  `docs/business-rules/project-business-rules.md`
- project data-protection implementation plan at
  `docs/security/data-protection-plan.md`
- key-management tests proving algorithm/key-version metadata, no plaintext
  data encryption key storage, and no UI access to KMS or Secret Manager
- administrative payload encryption/key-ceremony evidence when the project
  handles legal, tax, financial, identity, provider, or banking documents
- secret/log/evidence redaction tests
- app surface and action inventory
- live Firebase posture check for `ac-tech-data`

All Firestore clients, Admin SDK code, REST calls, tests, rules, and indexes
must target database ID `ac-tech-data` explicitly.

Any personal information is sensitive under AC Tech policy. LGPD sensitive
personal data, credentials, financial/legal data, mailbox data, AI memory, and
user-client data require stronger handling and must not be persisted in
plaintext.

Root account data must not store plaintext names, emails, phone numbers,
photos, dates of birth, addresses, government identifiers, or equivalent
profile/contact fields. Use encrypted fields, hashes, token references, or
keyed blind indexes through the app data-protection layer.

Do not invent per-project key handling. Use the AC Tech application
key-management standard and record any approved deviation in the project LGPD
register, business rules, and security docs.

No app may claim LGPD readiness, privacy readiness, production readiness, or
release readiness while its privacy register is missing, placeholder-only, or
not owner-reviewed.

## Company QA Identities

- Testing mailbox and first-party QA evidence: `qa@ac-tech.pro`
- Official Google-provider QA account: `ac.tech.qa@gmail.com`
- Production-readiness Google-provider evidence must use the official account.

Do not store passwords, recovery codes, 2FA material, app passwords, or session
cookies for these accounts in source, docs, `.env.local`, logs, QA artifacts,
or owner-readable Firestore documents. Temporary Gmail accounts are allowed
only as explicit owner-approved local emergency overrides.

## Business Rules And Brand

- Project business rules require owner approval and must not conflict with
  global AC Tech rules.
- Global AC Tech business rules may be modified only by
  `AC-Tech-Pro-Oficial` (`contas@ac-tech.pro`), operated by Moacir Costa or
  Vinicyus Abdala.
- Products must respect the corporate identity baseline in
  `<AC_TECH_ROOT>\docs\corporate-identity.md`.
- Frontend-capable products must keep root `DESIGN.md` and
  `docs/design/design-spec.json` current before UI implementation or
  release-readiness claims.
- Light and dark themes are required by default and must follow the system
  setting unless an owner-approved exception is recorded.
- English (`en`) and Portuguese Brazil (`pt-BR`) are required by default and
  must follow the system locale unless an owner-approved exception is
  recorded.
- If the user has not provided a design spec sheet, agents must ask for design
  intent or generate a provisional spec from the product context and
  corporate identity, then record it in the project design files.
- AC Tech brand assets, providers, domains, databases, and mailboxes must not
  be used for projects marked `.non-ac-tech-project`.

## Current Exceptions

List only approved, dated exceptions with an owner and removal condition.

- None.
