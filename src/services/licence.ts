// Licence gate for the paid edition (Paid via Atlassian).
//
// Per Atlassian's Forge licensing docs, `context.license` is only present for paid apps in the
// production environment; it is undefined for free apps, unlisted apps and non-production
// environments. When present, `license.active` is true only for a valid licence.
// So: no licence object -> allowed (free edition, development); licence object that is not
// active (trial ended, subscription cancelled) -> blocked.

export interface LicenceInfo {
  active?: boolean;
}

export function isLicenceBlocked(license: LicenceInfo | null | undefined): boolean {
  return !!license && typeof license === 'object' && license.active !== true;
}

export const LICENCE_MESSAGE =
  'Capacity Planner Pro needs an active subscription for this Jira site. Ask a Jira admin to start a trial or subscribe in Manage apps.';
