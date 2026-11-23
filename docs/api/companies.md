# Companies and brands

Company data is always tenant-scoped. A company outside the caller's scope answers `404`.

## Endpoints

| Method | Path                                        | Permission       | Notes                                                                       |
| ------ | ------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| GET    | `/api/companies`                            | `company.read`   | Lists visible companies.                                                    |
| POST   | `/api/companies`                            | `company.manage` | Creates a company. Returns `201`.                                           |
| PATCH  | `/api/companies/:companyId`                 | `company.manage` | Renames, suspends, archives, or re-activates a company. Nothing is deleted. |
| GET    | `/api/companies/:companyId/brands`          | `brand.read`     | Lists brands in the company.                                                |
| POST   | `/api/companies/:companyId/brands`          | `brand.manage`   | Creates a brand. Returns `201`.                                             |
| PATCH  | `/api/companies/:companyId/brands/:brandId` | `brand.manage`   | Renames a brand.                                                            |

Every write is audited. A suspended or archived company cannot be used for new publishing.
