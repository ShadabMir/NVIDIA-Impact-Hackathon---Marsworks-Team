// Map a saved profile (main app) onto the agent's access needs. Written by Yanki;
// used to build the agent's access needs from the profile.
export function profileNeeds(profile) {
  const access = profile.access;
  return {
    mobility_aid: ({ no_aid: "none", limited_mobility: "none" })[profile.mobility_aid] || profile.mobility_aid,
    max_gradient_pct: access.max_gradient_percent ?? "",
    max_continuous_roll_m: access.max_continuous_walking_m,
    max_total_roll_m: access.max_total_walking_m,
    step_free_required: access.step_free_required || access.wheelchair_user,
    extra_minutes: Math.min(120, access.min_transfer_minutes + access.boarding_buffer_minutes),
  };
}
