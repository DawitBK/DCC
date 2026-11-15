-- A scheduled publication can be cancelled before its time: the engine drops the post, the record stays.
alter table publications drop constraint publications_status_check;
alter table publications
  add constraint publications_status_check
  check (status in ('pending', 'scheduled', 'published', 'failed', 'cancelled'));
