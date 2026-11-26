import type { PublicationDto, PublicationRecordDto } from '@dcc/contracts';

/**
 * The screens read publications typed as `PublicationDto` (its `status` list does not have `removed`: the shared contract
 * file is not edited). The API now sends `PublicationRecordDto`; this is the one place that says so.
 */
export const recordOf = (publication: PublicationDto): PublicationRecordDto =>
  publication as unknown as PublicationRecordDto;

export const isRemoved = (publication: PublicationDto): boolean =>
  recordOf(publication).status === 'removed';

/** The content items made as corrections of this publication. */
export const correctionsOf = (publication: PublicationDto): string[] =>
  recordOf(publication).correctionContentItemIds ?? [];
