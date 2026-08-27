# 文件清单

本清单由 `scripts/validate_artifacts.py --write-manifest` 生成。
`MANIFEST.sha256` 不包含清单自身和验证报告，避免自引用哈希。

- 文件数：424
- 总字节数：2144347

## `./`

| 文件 | 字节 |
|---|---:|
| `CHANGELOG.md` | 37332 |
| `CONTRIBUTING_DOCS.md` | 5677 |
| `GLOSSARY.md` | 8482 |
| `IMPLEMENTATION-READINESS.md` | 4154 |
| `LICENSE-NOTICE.md` | 721 |
| `README.md` | 15270 |
| `REQUIREMENTS-TRACEABILITY.md` | 26220 |
| `VERSION.json` | 231 |
| `VERSION.md` | 3618 |
| `dsh-military-design-specification.md` | 466323 |

## `adr/`

| 文件 | 字节 |
|---|---:|
| `adr/0001-mission-ledger-and-session-log.md` | 782 |
| `adr/0002-harness-exclusive-acceptance-and-freeze.md` | 640 |
| `adr/0003-minimum-independently-verifiable-unit.md` | 575 |
| `adr/0004-brokered-staff-radio.md` | 590 |
| `adr/0005-engineer-exclusive-specs-and-local-main.md` | 686 |
| `adr/0006-versioned-tactical-procedure-lifecycle.md` | 646 |
| `adr/0007-role-based-thinking-required.md` | 567 |
| `adr/0008-three-stage-memory-pipeline.md` | 531 |
| `adr/0009-programmatic-agent-creation-and-thin-adapters.md` | 495 |
| `adr/0010-versioned-plans-and-wave-barriers.md` | 548 |
| `adr/0011-user-defined-advisors-with-least-privilege.md` | 563 |
| `adr/0012-event-first-webui.md` | 466 |
| `adr/0013-fixed-military-preset-and-session-isolation.md` | 1273 |
| `adr/0014-provenance-preserving-tactical-ingestion.md` | 935 |
| `adr/0015-versioned-department-agent-template-and-context-policy.md` | 936 |
| `adr/0016-root-owned-user-interaction-and-chief-fallback.md` | 965 |
| `adr/0017-evidence-normalized-agent-performance-evaluation.md` | 922 |
| `adr/0018-content-addressed-preset-generation-resume.md` | 688 |
| `adr/0019-json-schema-and-event-catalog-as-contract-truth.md` | 681 |
| `adr/0020-principal-tenant-authority-context.md` | 619 |
| `adr/0021-isolated-worktree-candidate-patch-integration.md` | 627 |
| `adr/0022-transactional-outbox-and-event-upcasting.md` | 610 |
| `adr/0023-general-model-default-owned-by-military-preset.md` | 649 |
| `adr/0024-durable-root-owned-decision-broker.md` | 650 |
| `adr/0025-rc2-capability-probe-fail-closed.md` | 603 |
| `adr/0026-atomic-bundle-lifecycle.md` | 583 |
| `adr/0027-provenance-rights-and-revocation-knowledge-supply-chain.md` | 600 |
| `adr/0028-difficulty-adjusted-reproducible-performance-evaluation.md` | 3853 |
| `adr/0029-golden-traces-and-model-checked-invariants.md` | 592 |
| `adr/0030-immutable-agent-execution-binding.md` | 1203 |
| `adr/0031-reservation-before-expensive-work.md` | 1005 |
| `adr/0032-immutable-performance-reports-and-appeals.md` | 924 |
| `adr/0033-mission-atomic-evidence-and-rc2-release-gate.md` | 917 |
| `adr/0033-mission-kernel-single-writer-command-bus.md` | 295 |
| `adr/0034-context-manifest-and-claim-evidence-graph.md` | 285 |
| `adr/0035-capability-based-adaptive-execution-routing.md` | 292 |
| `adr/0036-agentic-zero-trust-short-lived-grants.md` | 256 |
| `adr/0037-rc2-exact-baseline-and-thin-adapter.md` | 623 |
| `adr/0038-agent-team-is-non-authoritative.md` | 263 |

## `checklists/`

| 文件 | 字节 |
|---|---:|
| `checklists/advisor-onboarding.md` | 610 |
| `checklists/agent-execution-binding.md` | 666 |
| `checklists/agent-template-and-compaction.md` | 783 |
| `checklists/authorization-and-cross-session.md` | 528 |
| `checklists/brainstorm-and-user-decisions.md` | 795 |
| `checklists/candidate-acceptance.md` | 573 |
| `checklists/contract-freeze.md` | 1109 |
| `checklists/incident-response.md` | 572 |
| `checklists/military-preset-isolation.md` | 887 |
| `checklists/mvp-readiness.md` | 1091 |
| `checklists/performance-evaluation-appeal.md` | 2304 |
| `checklists/performance-evaluation.md` | 747 |
| `checklists/preset-upgrade-resume.md` | 677 |
| `checklists/release-readiness.md` | 906 |
| `checklists/resource-budget-settlement.md` | 585 |
| `checklists/source-release.md` | 841 |
| `checklists/specs-maintenance.md` | 636 |
| `checklists/tactical-ingestion-review.md` | 793 |
| `checklists/tactical-skill-promotion.md` | 622 |
| `checklists/task-order-quality.md` | 633 |
| `checklists/wave-readiness.md` | 645 |
| `checklists/workspace-integration.md` | 582 |

## `contracts/`

| 文件 | 字节 |
|---|---:|
| `contracts/ERROR-CATALOG.md` | 10685 |
| `contracts/EVENT-CATALOG.md` | 12461 |
| `contracts/README.md` | 1307 |
| `contracts/error-catalog.json` | 19279 |
| `contracts/event-catalog.json` | 112232 |
| `contracts/example-map.json` | 3819 |
| `contracts/parity-map.json` | 5447 |

## `diagrams/`

| 文件 | 字节 |
|---|---:|
| `diagrams/01-system-context.mmd` | 513 |
| `diagrams/02-five-planes.mmd` | 714 |
| `diagrams/03-mission-lifecycle.mmd` | 619 |
| `diagrams/04-direction-wave-task.mmd` | 317 |
| `diagrams/05-staff-council.mmd` | 754 |
| `diagrams/06-candidate-verification.mmd` | 696 |
| `diagrams/07-radio-escalation.mmd` | 686 |
| `diagrams/08-oversight-freeze.mmd` | 472 |
| `diagrams/09-engineer-git.mmd` | 571 |
| `diagrams/10-memory-learning-loop.mmd` | 441 |
| `diagrams/11-data-truth.mmd` | 363 |
| `diagrams/12-military-preset-isolation.mmd` | 546 |
| `diagrams/13-tactical-ingestion.mmd` | 588 |
| `diagrams/14-agent-template-compaction.mmd` | 528 |
| `diagrams/15-brainstorm-chief-fallback.mmd` | 614 |
| `diagrams/16-evaluation-committee.mmd` | 598 |
| `diagrams/contract-generation.mmd` | 318 |
| `diagrams/decision-broker.mmd` | 495 |
| `diagrams/knowledge-supply-chain.mmd` | 439 |
| `diagrams/preset-generation-resume.mmd` | 489 |
| `diagrams/workspace-integration.mmd` | 422 |

## `docs/`

| 文件 | 字节 |
|---|---:|
| `docs/00-executive-design.md` | 9140 |
| `docs/01-design-principles.md` | 6187 |
| `docs/02-system-context.md` | 5384 |
| `docs/03-organizational-model.md` | 4918 |
| `docs/04-mission-lifecycle.md` | 4591 |
| `docs/05-direction-wave-task-planning.md` | 8829 |
| `docs/06-general-agent.md` | 6146 |
| `docs/07-staff-department.md` | 6993 |
| `docs/08-worker-forces.md` | 4763 |
| `docs/09-engineer-corps-and-specs.md` | 5142 |
| `docs/10-oversight-corps.md` | 4756 |
| `docs/11-staff-radio.md` | 4047 |
| `docs/12-tactical-skills.md` | 7200 |
| `docs/13-logistics-research.md` | 4825 |
| `docs/14-verification-and-acceptance.md` | 4481 |
| `docs/15-event-sourcing-and-state.md` | 5048 |
| `docs/16-dsh-integration.md` | 9741 |
| `docs/17-webui.md` | 15150 |
| `docs/18-security-and-permissions.md` | 7536 |
| `docs/19-observability-and-metrics.md` | 4574 |
| `docs/20-testing-and-evaluation.md` | 5188 |
| `docs/21-package-topology.md` | 14133 |
| `docs/22-implementation-roadmap.md` | 7101 |
| `docs/23-risk-register.md` | 8154 |
| `docs/24-operations-runbook.md` | 12680 |
| `docs/25-reference-sources.md` | 4275 |
| `docs/26-historical-design-abstraction.md` | 4024 |
| `docs/27-api-and-data-contracts.md` | 14253 |
| `docs/28-governance-and-change-control.md` | 4426 |
| `docs/29-model-routing-and-reasoning-policy.md` | 7005 |
| `docs/30-failure-recovery-and-chaos.md` | 8518 |
| `docs/31-implementation-blueprint.md` | 8681 |
| `docs/32-military-preset-and-session-isolation.md` | 12323 |
| `docs/33-tactical-ingestion-and-tag-governance.md` | 15161 |
| `docs/34-department-agent-templates-and-context-policy.md` | 13274 |
| `docs/35-brainstorm-command-and-decision-dialogues.md` | 8121 |
| `docs/36-chief-of-staff-fallback.md` | 6333 |
| `docs/37-military-evaluation-committee.md` | 13074 |
| `docs/38-preset-generation-upgrade-and-resume.md` | 6176 |
| `docs/39-contract-source-of-truth-and-code-generation.md` | 4833 |
| `docs/40-principal-tenant-authorization-model.md` | 3586 |
| `docs/41-workspace-integration-and-merge-protocol.md` | 5252 |
| `docs/42-physical-storage-and-migration-design.md` | 5048 |
| `docs/43-general-model-and-session-policy-precedence.md` | 5235 |
| `docs/44-decision-broker-state-machine.md` | 3315 |
| `docs/45-compatibility-probe-and-feature-matrix.md` | 2959 |
| `docs/46-install-upgrade-rollback-uninstall.md` | 5023 |
| `docs/47-tactical-knowledge-supply-chain.md` | 4900 |
| `docs/48-evaluation-statistics-and-fairness.md` | 14163 |
| `docs/49-conformance-and-model-checking.md` | 4020 |
| `docs/50-resource-budget-and-admission-control.md` | 5951 |
| `docs/51-webui-interaction-and-conflict-ux.md` | 8853 |
| `docs/52-product-terminology-and-safety-boundary.md` | 4036 |
| `docs/53-source-code-architecture-and-package-reference.md` | 5398 |
| `docs/54-build-test-install-and-operations.md` | 5537 |
| `docs/55-code-review-security-and-rc2-conformance.md` | 3276 |
| `docs/56-known-rc2-limitations-and-migration-boundary.md` | 2132 |
| `docs/57-performance-evaluation-runtime.md` | 17639 |
| `docs/58-worker-workspace-and-child-spawn-runtime.md` | 2555 |
| `docs/59-web-client-packaging-and-surfaces.md` | 5352 |
| `docs/60-mission-kernel-2-and-command-bus.md` | 2295 |
| `docs/61-context-compiler-and-evidence-graph.md` | 2548 |
| `docs/62-adaptive-execution-router-and-parallelism.md` | 1572 |
| `docs/63-agentic-zero-trust-and-capability-grants.md` | 1212 |
| `docs/64-observability-and-decision-chain-evaluation.md` | 1033 |
| `docs/65-rc2-compatibility-and-adapter-migration.md` | 2784 |
| `docs/66-legacy-to-rc2-upgrade-runbook.md` | 1424 |
| `docs/67-military-control-center-flash-workbench-and-accessibility.md` | 13048 |
| `docs/68-general-workflow-live-models-and-settings-persistence.md` | 6760 |
| `docs/INDEX.md` | 8842 |

## `examples/`

| 文件 | 字节 |
|---|---:|
| `examples/README.md` | 14402 |
| `examples/cordis.patch.example.yml` | 2517 |
| `examples/settings.example.yml` | 1999 |

## `examples/brainstorm/`

| 文件 | 字节 |
|---|---:|
| `examples/brainstorm/brainstorm-order.example.yaml` | 865 |
| `examples/brainstorm/decision-question-set.example.yaml` | 1023 |

## `examples/bundle/`

| 文件 | 字节 |
|---|---:|
| `examples/bundle/package.example.json` | 1717 |

## `examples/contracts/`

| 文件 | 字节 |
|---|---:|
| `examples/contracts/agent-execution-binding.example.yaml` | 1729 |
| `examples/contracts/authority-context.example.yaml` | 438 |
| `examples/contracts/bundle-lifecycle-receipt.example.yaml` | 462 |
| `examples/contracts/candidate-patch.example.yaml` | 647 |
| `examples/contracts/change-order.example.yaml` | 544 |
| `examples/contracts/compaction-attempt.example.yaml` | 582 |
| `examples/contracts/compatibility-report.example.yaml` | 1380 |
| `examples/contracts/data-residency-policy.example.yaml` | 280 |
| `examples/contracts/decision-broker-record.example.yaml` | 404 |
| `examples/contracts/enterprise-api-grant.example.yaml` | 592 |
| `examples/contracts/evaluation-dataset-manifest.example.yaml` | 1599 |
| `examples/contracts/general-execution-policy.example.yaml` | 781 |
| `examples/contracts/integration-conflict-report.example.yaml` | 487 |
| `examples/contracts/integration-order.example.yaml` | 440 |
| `examples/contracts/integration-receipt.example.yaml` | 464 |
| `examples/contracts/knowledge-revocation-order.example.yaml` | 382 |
| `examples/contracts/military-failure.example.json` | 267 |
| `examples/contracts/model-capability-profile.example.yaml` | 580 |
| `examples/contracts/model-selection-receipt.example.yaml` | 388 |
| `examples/contracts/performance-evaluation-appeal.example.yaml` | 702 |
| `examples/contracts/permission-profile.example.yaml` | 522 |
| `examples/contracts/preset-generation-manifest.example.yaml` | 755 |
| `examples/contracts/preset-migration-order.example.yaml` | 516 |
| `examples/contracts/preset-resume-receipt.example.yaml` | 761 |
| `examples/contracts/redaction-policy.example.yaml` | 265 |
| `examples/contracts/resource-budget-policy.example.yaml` | 415 |
| `examples/contracts/resource-budget-reservation.example.yaml` | 898 |
| `examples/contracts/resource-usage-receipt.example.yaml` | 740 |
| `examples/contracts/tactical-source-snapshot.example.yaml` | 1213 |
| `examples/contracts/tool-profile.example.yaml` | 344 |
| `examples/contracts/user-authorization-receipt.example.yaml` | 443 |
| `examples/contracts/verifier-profile.example.yaml` | 402 |
| `examples/contracts/workspace-lease.example.yaml` | 589 |
| `examples/contracts/workspace-snapshot.example.yaml` | 886 |

## `examples/evaluation/`

| 文件 | 字节 |
|---|---:|
| `examples/evaluation/evaluation-attempt-record.example.yaml` | 2476 |
| `examples/evaluation/frozen-evaluation-dataset.example.yaml` | 1077 |
| `examples/evaluation/military-performance-report.example.yaml` | 7825 |
| `examples/evaluation/performance-evaluation-request.example.yaml` | 727 |
| `examples/evaluation/worker-template-performance.example.yaml` | 4755 |

## `examples/events/`

| 文件 | 字节 |
|---|---:|
| `examples/events/administrative-ledger.example.jsonl` | 17050 |
| `examples/events/inspection-report.example.yaml` | 1086 |
| `examples/events/mission-ledger.example.jsonl` | 32242 |

## `examples/git/`

| 文件 | 字节 |
|---|---:|
| `examples/git/promotion-order.example.yaml` | 450 |

## `examples/kernel/`

| 文件 | 字节 |
|---|---:|
| `examples/kernel/capability-grant.example.yaml` | 433 |
| `examples/kernel/claim-evidence-graph.example.yaml` | 411 |
| `examples/kernel/context-manifest.example.yaml` | 781 |
| `examples/kernel/execution-strategy.example.yaml` | 322 |
| `examples/kernel/mission-command.example.yaml` | 573 |
| `examples/kernel/task-capability-profile.example.yaml` | 518 |

## `examples/memory/`

| 文件 | 字节 |
|---|---:|
| `examples/memory/effectiveness-assessment.example.yaml` | 1450 |
| `examples/memory/tactical-memory.example.yaml` | 1729 |
| `examples/memory/tactical-report.example.yaml` | 1095 |

## `examples/mission/`

| 文件 | 字节 |
|---|---:|
| `examples/mission/mission-intent.example.yaml` | 1863 |

## `examples/planning/`

| 文件 | 字节 |
|---|---:|
| `examples/planning/direction-plan.example.yaml` | 1148 |
| `examples/planning/wave-plan.example.yaml` | 947 |

## `examples/preset/`

| 文件 | 字节 |
|---|---:|
| `examples/preset/agent-presets-profile-overlay.example.yml` | 718 |
| `examples/preset/military-session-binding.example.yaml` | 625 |

## `examples/preset/military/`

| 文件 | 字节 |
|---|---:|
| `examples/preset/military/agent.cordis.yml` | 4112 |
| `examples/preset/military/preset.yml` | 165 |

## `examples/radio/`

| 文件 | 字节 |
|---|---:|
| `examples/radio/tactical-guidance.example.yaml` | 2123 |
| `examples/radio/tactical-request.example.yaml` | 1893 |

## `examples/specs/`

| 文件 | 字节 |
|---|---:|
| `examples/specs/specs-maintenance-order.example.yaml` | 1014 |

## `examples/staff/`

| 文件 | 字节 |
|---|---:|
| `examples/staff/backend-advisor.example.yaml` | 1601 |
| `examples/staff/chief-of-staff-advice.example.yaml` | 2859 |
| `examples/staff/frontend-advisor.example.yaml` | 975 |

## `examples/tactical-ingestion/`

| 文件 | 字节 |
|---|---:|
| `examples/tactical-ingestion/direct-experience-request.example.yaml` | 963 |
| `examples/tactical-ingestion/react-extraction-candidate.example.yaml` | 2480 |
| `examples/tactical-ingestion/react-tag.example.yaml` | 388 |
| `examples/tactical-ingestion/session-ingestion-request.example.yaml` | 772 |

## `examples/tactics/`

| 文件 | 字节 |
|---|---:|
| `examples/tactics/tactical-skill.example.yaml` | 3667 |

## `examples/tasks/`

| 文件 | 字节 |
|---|---:|
| `examples/tasks/acceptance-contract.example.yaml` | 1031 |
| `examples/tasks/candidate-submission.example.yaml` | 2164 |
| `examples/tasks/task-order.example.yaml` | 1409 |

## `examples/templates/`

| 文件 | 字节 |
|---|---:|
| `examples/templates/worker-template.example.yaml` | 1512 |

## `examples/traces/`

| 文件 | 字节 |
|---|---:|
| `examples/traces/agent-binding-budget.example.yaml` | 1218 |
| `examples/traces/brainstorm-decision.example.yaml` | 1028 |
| `examples/traces/bundle-install-rollback.example.yaml` | 761 |
| `examples/traces/candidate-acceptance.example.yaml` | 1030 |
| `examples/traces/compaction-effectiveness.example.yaml` | 1030 |
| `examples/traces/decision-relay.example.yaml` | 674 |
| `examples/traces/evaluation.example.yaml` | 825 |
| `examples/traces/freeze-release.example.yaml` | 636 |
| `examples/traces/general-model-switch.example.yaml` | 1019 |
| `examples/traces/integration-conflict.example.yaml` | 670 |
| `examples/traces/performance-appeal.example.yaml` | 1383 |
| `examples/traces/preset-restart-resume.example.yaml` | 677 |
| `examples/traces/radio-guidance.example.yaml` | 928 |
| `examples/traces/rework.example.yaml` | 634 |
| `examples/traces/specs-integration.example.yaml` | 930 |
| `examples/traces/tactical-revocation.example.yaml` | 836 |

## `quality/`

| 文件 | 字节 |
|---|---:|
| `quality/CONTRACT-CONFORMANCE.md` | 766 |
| `quality/DATA-RETENTION.md` | 4188 |
| `quality/EVALUATION-PROTOCOL.md` | 1792 |
| `quality/EVALUATION-STATISTICS-PROTOCOL.md` | 5973 |
| `quality/MODEL-BENCHMARK.md` | 5820 |
| `quality/PERFORMANCE-METRICS-CATALOG.md` | 2049 |
| `quality/RC2-FULL-REPAIR-CLOSURE.md` | 3810 |
| `quality/SLO.md` | 3766 |
| `quality/SOURCE-CODE-REVIEW.md` | 1086 |
| `quality/SOURCE-TEST-REPORT.md` | 959 |
| `quality/TACTICAL-INGESTION-QUALITY.md` | 1109 |
| `quality/TEST-MATRIX.md` | 11122 |
| `quality/THREAT-MODEL.md` | 7534 |

## `reference/dsh-rc2/`

| 文件 | 字节 |
|---|---:|
| `reference/dsh-rc2/README.md` | 845 |
| `reference/dsh-rc2/compatibility-matrix.yml` | 1567 |
| `reference/dsh-rc2/fixture-cases.yml` | 6719 |
| `reference/dsh-rc2/source-fingerprints.json` | 2152 |

## `reference/preset/`

| 文件 | 字节 |
|---|---:|
| `reference/preset/README.md` | 3032 |
| `reference/preset/package.example.json` | 796 |
| `reference/preset/profile-installer-pseudocode.ts` | 2665 |

## `reference/preset/agent-presets/military/`

| 文件 | 字节 |
|---|---:|
| `reference/preset/agent-presets/military/agent.cordis.yml` | 4112 |
| `reference/preset/agent-presets/military/generation-manifest.json` | 972 |
| `reference/preset/agent-presets/military/preset.yml` | 165 |

## `reference/preset/generations/054486e73b1b1f8385782497cda79e9a887897fbc338dd9bc6ca80d01a1e8146/`

| 文件 | 字节 |
|---|---:|
| `reference/preset/generations/054486e73b1b1f8385782497cda79e9a887897fbc338dd9bc6ca80d01a1e8146/agent.cordis.yml` | 4112 |
| `reference/preset/generations/054486e73b1b1f8385782497cda79e9a887897fbc338dd9bc6ca80d01a1e8146/generation-manifest.json` | 972 |
| `reference/preset/generations/054486e73b1b1f8385782497cda79e9a887897fbc338dd9bc6ca80d01a1e8146/preset.yml` | 165 |

## `reference/preset/generations/2e76d996d809fde6303a4d190a1e86e9be4d22581346e46e24a4322258217681/`

| 文件 | 字节 |
|---|---:|
| `reference/preset/generations/2e76d996d809fde6303a4d190a1e86e9be4d22581346e46e24a4322258217681/agent.cordis.yml` | 3899 |
| `reference/preset/generations/2e76d996d809fde6303a4d190a1e86e9be4d22581346e46e24a4322258217681/generation-manifest.json` | 971 |
| `reference/preset/generations/2e76d996d809fde6303a4d190a1e86e9be4d22581346e46e24a4322258217681/preset.yml` | 165 |

## `reference/preset/generations/8ad0480269a69a29358d55b8074a4211099816e3752301b62bab11fe1e466e8a/`

| 文件 | 字节 |
|---|---:|
| `reference/preset/generations/8ad0480269a69a29358d55b8074a4211099816e3752301b62bab11fe1e466e8a/agent.cordis.yml` | 4032 |
| `reference/preset/generations/8ad0480269a69a29358d55b8074a4211099816e3752301b62bab11fe1e466e8a/generation-manifest.json` | 971 |
| `reference/preset/generations/8ad0480269a69a29358d55b8074a4211099816e3752301b62bab11fe1e466e8a/preset.yml` | 165 |

## `reference/preset/generations/f27cf981c025cac821723f7987ab0398709ff46ebb7f96883b2bd964ef835cf7/`

| 文件 | 字节 |
|---|---:|
| `reference/preset/generations/f27cf981c025cac821723f7987ab0398709ff46ebb7f96883b2bd964ef835cf7/agent.cordis.yml` | 4034 |
| `reference/preset/generations/f27cf981c025cac821723f7987ab0398709ff46ebb7f96883b2bd964ef835cf7/generation-manifest.json` | 972 |
| `reference/preset/generations/f27cf981c025cac821723f7987ab0398709ff46ebb7f96883b2bd964ef835cf7/preset.yml` | 165 |

## `reference/sql/`

| 文件 | 字节 |
|---|---:|
| `reference/sql/0001-core.sql` | 6281 |
| `reference/sql/0002-indexes.sql` | 988 |
| `reference/sql/0003-projections.sql` | 1489 |
| `reference/sql/0004-governance.sql` | 7215 |
| `reference/sql/README.md` | 1284 |

## `reference/tla/`

| 文件 | 字节 |
|---|---:|
| `reference/tla/MilitaryCore.tla` | 2463 |

## `reference/types/`

| 文件 | 字节 |
|---|---:|
| `reference/types/README.md` | 2165 |
| `reference/types/config.ts` | 4869 |
| `reference/types/domain.ts` | 45608 |
| `reference/types/errors.ts` | 130 |
| `reference/types/events.ts` | 2460 |
| `reference/types/failure.ts` | 1312 |
| `reference/types/generated-error-catalog.ts` | 19666 |
| `reference/types/generated-event-catalog.ts` | 31798 |
| `reference/types/governance.ts` | 28071 |
| `reference/types/ids.ts` | 1353 |
| `reference/types/index.ts` | 384 |
| `reference/types/kernel.ts` | 5093 |
| `reference/types/permissions.ts` | 3917 |
| `reference/types/services.ts` | 25581 |
| `reference/types/state-machines.ts` | 4486 |
| `reference/types/tool-names.ts` | 2141 |
| `reference/types/tools.ts` | 3049 |
| `reference/types/tsconfig.json` | 313 |

## `schemas/`

| 文件 | 字节 |
|---|---:|
| `schemas/INDEX.md` | 11015 |
| `schemas/acceptance-contract.schema.json` | 2878 |
| `schemas/administrative-event.schema.json` | 34449 |
| `schemas/agent-execution-binding.schema.json` | 6985 |
| `schemas/agent-template-performance.schema.json` | 14932 |
| `schemas/agent-template-profile.schema.json` | 6192 |
| `schemas/authority-context.schema.json` | 1940 |
| `schemas/brainstorm-order.schema.json` | 3725 |
| `schemas/bundle-lifecycle-receipt.schema.json` | 1938 |
| `schemas/candidate-patch.schema.json` | 1770 |
| `schemas/candidate-submission.schema.json` | 2887 |
| `schemas/capability-grant.schema.json` | 1567 |
| `schemas/change-order.schema.json` | 3029 |
| `schemas/chief-of-staff-advice.schema.json` | 3956 |
| `schemas/claim-evidence-graph.schema.json` | 1870 |
| `schemas/common-defs.schema.json` | 8899 |
| `schemas/compaction-attempt.schema.json` | 2494 |
| `schemas/compatibility-report.schema.json` | 6902 |
| `schemas/conformance-trace.schema.json` | 2006 |
| `schemas/context-manifest.schema.json` | 2405 |
| `schemas/data-residency-policy.schema.json` | 1462 |
| `schemas/decision-broker-record.schema.json` | 1922 |
| `schemas/decision-question-set.schema.json` | 2654 |
| `schemas/direction-plan.schema.json` | 3139 |
| `schemas/effectiveness-assessment.schema.json` | 2841 |
| `schemas/enterprise-api-grant.schema.json` | 2438 |
| `schemas/evaluation-attempt-record.schema.json` | 11087 |
| `schemas/evaluation-dataset-manifest.schema.json` | 7516 |
| `schemas/execution-strategy.schema.json` | 1026 |
| `schemas/frozen-evaluation-dataset.schema.json` | 1570 |
| `schemas/general-execution-policy.schema.json` | 4205 |
| `schemas/inspection-report.schema.json` | 2157 |
| `schemas/integration-conflict-report.schema.json` | 1348 |
| `schemas/integration-order.schema.json` | 1668 |
| `schemas/integration-receipt.schema.json` | 1571 |
| `schemas/knowledge-revocation-order.schema.json` | 1684 |
| `schemas/military-failure.schema.json` | 2823 |
| `schemas/military-performance-report.schema.json` | 10779 |
| `schemas/military-session-binding.schema.json` | 1726 |
| `schemas/military-settings.schema.json` | 10449 |
| `schemas/mission-command.schema.json` | 1699 |
| `schemas/mission-event.schema.json` | 59476 |
| `schemas/mission-intent.schema.json` | 3715 |
| `schemas/model-capability-profile.schema.json` | 3174 |
| `schemas/model-selection-receipt.schema.json` | 1620 |
| `schemas/performance-evaluation-appeal.schema.json` | 2813 |
| `schemas/performance-evaluation-request.schema.json` | 3697 |
| `schemas/permission-profile.schema.json` | 3019 |
| `schemas/preset-generation-manifest.schema.json` | 2573 |
| `schemas/preset-migration-order.schema.json` | 1550 |
| `schemas/preset-resume-receipt.schema.json` | 2175 |
| `schemas/promotion-order.schema.json` | 1898 |
| `schemas/redaction-policy.schema.json` | 1492 |
| `schemas/resource-budget-policy.schema.json` | 2507 |
| `schemas/resource-budget-reservation.schema.json` | 3926 |
| `schemas/resource-usage-receipt.schema.json` | 3819 |
| `schemas/specs-maintenance-order.schema.json` | 2644 |
| `schemas/staff-advisor-profile.schema.json` | 4671 |
| `schemas/tactical-extraction-candidate.schema.json` | 8663 |
| `schemas/tactical-guidance.schema.json` | 2570 |
| `schemas/tactical-ingestion-request.schema.json` | 4704 |
| `schemas/tactical-memory.schema.json` | 2703 |
| `schemas/tactical-report.schema.json` | 2838 |
| `schemas/tactical-request.schema.json` | 3376 |
| `schemas/tactical-skill.schema.json` | 6716 |
| `schemas/tactical-source-snapshot.schema.json` | 3674 |
| `schemas/tactical-tag.schema.json` | 1761 |
| `schemas/task-capability-profile.schema.json` | 1993 |
| `schemas/task-order.schema.json` | 3899 |
| `schemas/tool-profile.schema.json` | 1592 |
| `schemas/user-authorization-receipt.schema.json` | 1586 |
| `schemas/verifier-profile.schema.json` | 2067 |
| `schemas/wave-plan.schema.json` | 2911 |
| `schemas/workspace-lease.schema.json` | 1599 |
| `schemas/workspace-snapshot.schema.json` | 1832 |

## `scripts/`

| 文件 | 字节 |
|---|---:|
| `scripts/build_single_spec.py` | 5913 |
| `scripts/compute_preset_generation.py` | 2574 |
| `scripts/generate_contract_artifacts.py` | 12475 |
| `scripts/generate_error_artifacts.py` | 3680 |
| `scripts/requirements-validation.txt` | 172 |
| `scripts/update_indexes.py` | 3650 |
| `scripts/validate_artifacts.py` | 34235 |

## `templates/reports/`

| 文件 | 字节 |
|---|---:|
| `templates/reports/military-performance-report.md` | 804 |

## `templates/specs/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/README.md` | 820 |
| `templates/specs/specs-manifest.yaml` | 957 |

## `templates/specs/00-mission/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/00-mission/mission-intent.md` | 562 |

## `templates/specs/01-requirements/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/01-requirements/functional-requirements.md` | 402 |
| `templates/specs/01-requirements/non-functional-requirements.md` | 294 |

## `templates/specs/02-architecture/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/02-architecture/components.md` | 259 |
| `templates/specs/02-architecture/data-and-events.md` | 287 |
| `templates/specs/02-architecture/system-context.md` | 341 |

## `templates/specs/03-decisions/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/03-decisions/ADR-TEMPLATE.md` | 167 |

## `templates/specs/04-planning/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/04-planning/directions.md` | 164 |
| `templates/specs/04-planning/waves.md` | 230 |

## `templates/specs/05-verification/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/05-verification/acceptance-matrix.md` | 237 |
| `templates/specs/05-verification/test-strategy.md` | 249 |

## `templates/specs/06-operations/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/06-operations/runbook.md` | 218 |

## `templates/specs/07-traceability/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/07-traceability/traceability-matrix.md` | 335 |

## `templates/specs/08-history/`

| 文件 | 字节 |
|---|---:|
| `templates/specs/08-history/change-log.md` | 143 |

## `templates/tactics/`

| 文件 | 字节 |
|---|---:|
| `templates/tactics/extraction-review.md` | 561 |
