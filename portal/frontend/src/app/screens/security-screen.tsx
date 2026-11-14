import { NotAvailableYet } from '@/components/not-available';

const TEXT = {
  title: "Security center",
  description: "Account connection health and governance signals in one place.",
  headline: "DCC does not report live security state on this screen yet.",
  waitsFor:
    "The security center endpoint (backlog item H-10). Until it exists, use Social accounts for account status, Incidents for open issues and Activity audit for the record of actions.",
};

/** No backend yet: the security center endpoint is backlog item H-10. */
export function SecurityScreen() {
  return <NotAvailableYet {...TEXT} />;
}
