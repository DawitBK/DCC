import { NotAvailableYet } from '@/components/not-available';

const TEXT = {
  title: "Analytics & reports",
  description: "Followers, reach, impressions and engagement for the official accounts.",
  headline: "DCC has no audience figures yet.",
  waitsFor:
    "The publishing engine. Followers, reach and engagement come from the engine that talks to the social networks, and it is not connected yet. Counts DCC already knows (accounts, content, publications) are on the Dashboard.",
};

/** No backend yet: audience analytics come from the operational engine (docs/api/reports.md). */
export function AnalyticsScreen() {
  return <NotAvailableYet {...TEXT} />;
}
