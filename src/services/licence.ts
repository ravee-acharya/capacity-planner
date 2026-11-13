// Licence gate for the paid edition (Paid via Atlassian).
//
// Jira only includes `license` in the invocation context for apps whose manifest enables
// licensing, so the free edition never has one and is never blocked. For the paid edition the
// app is blocked only when Jira explicitly reports the licence as inactive (trial ended,
// subscription cancelled). No licence object - e.g. before the Marketplace listing goes live,
// or in development - means the app is allowed.

export interface LicenceInfo {
  isActive?: boolean;
}

export function isLicenceBlocked(license: LicenceInfo | null | undefined): boolean {
  return !!license && typeof license === 'object' && license.isActive === false;
}

export const LICENCE_MESSAGE =
  'Capacity Planner Pro needs an active subscription for this Jira site. Ask a Jira admin to start a trial or subscribe in Manage apps.';
