# Content media

Media belongs to a company and is referenced by content versions. Files are stored outside the database; the database stores metadata and the tenant ownership.

## Endpoints

| Method | Path                          | Permission       | Notes                                                                                      |
| ------ | ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| POST   | `/api/media?companyId=<uuid>` | `content.create` | Multipart upload with one file in the `file` field. Returns `201`. Maximum size is 200 MB. |
| GET    | `/api/media/:id/file`         | `content.read`   | Streams an in-scope file with a private cache policy and range support.                    |

The upload does not publish anything. Media reaches the operational engine only when an approved content version is published through `GovernedEngine`.
