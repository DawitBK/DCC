import { NotAvailableYet } from '@/components/not-available';

const TEXT = {
  title: "Unified inbox",
  description: "A shared queue for social conversations across connected company accounts.",
  headline: "No social messages are fetched or shown here.",
  waitsFor:
    "The unified inbox in the customised Postiz (the Postiz fork). When that is ready, messages appear here grouped by company and social account.",
};

/** No backend yet: the inbox is built in the Postiz fork. */
export function InboxScreen() {
  return <NotAvailableYet {...TEXT} />;
}
