import { NotAvailableYet } from '@/components/not-available';

const TEXT = {
  title: "Content calendar",
  description: "Planned and scheduled content across company channels.",
  headline: "Scheduling is not built yet, so there is nothing real to put on a calendar.",
  waitsFor:
    "The publishing engine. DCC can publish an approved post now, but it cannot schedule one for later yet. When scheduled publishing exists, planned posts appear here.",
};

/** No backend yet: scheduled publishing does not exist (docs/api/publishing.md, "Not built yet"). */
export function CalendarScreen() {
  return <NotAvailableYet {...TEXT} />;
}
