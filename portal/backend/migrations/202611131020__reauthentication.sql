-- Re-authentication for sensitive actions (task L-07). Owner: Dawit.
--
-- A session can live for hours. Before a sensitive action (granting a role, lifting a publishing freeze,
-- exporting the audit trail) DCC wants proof that the person at the keyboard signed in a short while ago,
-- not just that a session cookie exists. The SSO states when the person last proved who they are in the
-- `auth_time` claim; the session remembers it here.
--
-- Existing sessions get NULL ("not known"): they must re-authenticate before a sensitive action, which is
-- the safe reading. Rows inserted without the column (the development session helper, tests) get now().

alter table sessions add column authenticated_at timestamptz;
alter table sessions alter column authenticated_at set default now();

-- Set when a sign-in was started as a re-authentication: the callback then insists on a fresh `auth_time`.
alter table auth_transactions add column reauth boolean not null default false;
