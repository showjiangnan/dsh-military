/** Map Military report priority to the exact RC.2 delivery vocabulary. */
export function rc2ReportDelivery(priority: 'ordinary' | 'critical'): 'quiet' | 'next-step' {
  // A top-level General can be idle after deliberately ending its current
  // turn while a continuable child keeps working. Quiet delivery would put the
  // report in that idle Agent's inbox without scheduling a consumer. RC.2's
  // next-step delivery wakes an idle parent and steers a busy parent at its
  // nearest step boundary, which is the required behavior for both priorities.
  void priority
  return 'next-step'
}
