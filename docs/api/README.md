# API (Hirko)

The running API documents itself: start it and open `/api/docs` (Swagger, off in production unless enabled). Write here: `MODULE-PLAN.md` (H-01), per-module notes (rules, states, who may do what), and the
contract changes agreed with Rahel. Request and response types live in `portal/contracts`.

Conventions: errors are `{statusCode, error, message, requestId}`; validation errors also carry `issues`; ids are UUIDs; permissions are `resource.action`; a record outside the caller's scope answers 404.
