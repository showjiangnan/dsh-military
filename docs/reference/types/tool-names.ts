/** Stable model-facing Military tool vocabulary for the exact RC.2 preset. */
export const commonMilitaryToolNames = [
  'military_get_context',
  'military_read_artifact',
] as const

export const generalMilitaryToolNames = [
  ...commonMilitaryToolNames,
  'military_mission_start', 'military_task_create', 'military_task_get',
  'military_spawn_department_agent', 'military_radio_poll', 'military_radio_issue',
  'military_decision_present', 'military_decision_answer',
  'military_tactical_ingest', 'military_tactical_review',
  'military_evaluation_start', 'military_evaluation_get', 'military_status',
] as const

export const workerMilitaryToolNames = [
  ...commonMilitaryToolNames,
  'military_get_order', 'military_get_tactical_directive',
  'military_record_observation', 'military_submit_candidate', 'military_submit_blocker',
  'military_radio_request', 'military_submit_decision_questions',
] as const

/** Always-available Task control plane; Task drafts constrain everything else. */
export const taskControlToolNames = [
  'military_get_context',
  'military_get_order',
  'military_submit_blocker',
  'report',
] as const

export const engineerMilitaryToolNames = [
  ...workerMilitaryToolNames,
  'military_specs_read', 'military_specs_apply_order',
] as const

export const staffMilitaryToolNames = [
  ...commonMilitaryToolNames,
  'military_staff_read_mission', 'military_staff_retrieve_tactics',
  'military_staff_issue_guidance', 'military_staff_chief_advice', 'military_submit_decision_questions',
] as const

export const inspectorMilitaryToolNames = [
  ...commonMilitaryToolNames,
  'military_inspect_agent', 'military_submit_inspection',
] as const

export const researchMilitaryToolNames = [
  ...commonMilitaryToolNames,
  'military_read_accepted_ledger', 'military_submit_research_artifact',
] as const

export const militaryToolNames = [...new Set([
  ...generalMilitaryToolNames, ...workerMilitaryToolNames, ...engineerMilitaryToolNames,
  ...staffMilitaryToolNames, ...inspectorMilitaryToolNames, ...researchMilitaryToolNames,
])] as const

export type MilitaryToolName = typeof militaryToolNames[number]
