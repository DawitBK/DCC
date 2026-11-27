-- Alert mobile numbers are stored sealed (AES-256-GCM through the secrets provider, ADR-0007), not as plain text.
-- The column keeps its name; its value is now the sealed text. The format check of the plain number moves to the API
-- (MobileNumber in @dcc/contracts); a row written before this migration holds the plain number and still opens.
alter table alert_contacts drop constraint if exists alert_contacts_mobile_check;
alter table alert_contacts add constraint alert_contacts_mobile_check check (length(mobile) between 8 and 2000);
