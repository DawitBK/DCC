import { PageTitle } from './page-title';
import { SectionPanel } from './section-panel';

const TEXT = {
  panelTitle: 'Not available yet',
  waitsFor: 'What it is waiting for',
  noSample: 'No figures are shown here until they are real.',
};

/**
 * A whole screen whose backend does not exist yet. It says so plainly and names what it waits for.
 * It never shows sample numbers to a signed-in person.
 */
export function NotAvailableYet({
  title,
  description,
  headline,
  waitsFor,
}: {
  title: string;
  description: string;
  headline: string;
  waitsFor: string;
}) {
  return (
    <>
      <PageTitle title={title} description={description} />
      <SectionPanel title={TEXT.panelTitle} subtitle={headline}>
        <div className="empty-state">
          <div>
            <strong>{TEXT.waitsFor}</strong>
            <p>{waitsFor}</p>
          </div>
        </div>
      </SectionPanel>
      <small className="hint">{TEXT.noSample}</small>
    </>
  );
}
