# Approval policy (H-09)

Approval policies are data, not hard-coded role rules. The signed approval matrix from A-05 is still the source for the final categories and approver roles. Until it arrives, the default is one approval from an eligible person who did not write any version of the content.

## Endpoints

| Method | Path                                      | Permission               | Notes                                                                              |
| ------ | ----------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| GET    | `/api/content-categories`                 | `content.read`           | Lists active and archived group categories visible to the caller.                  |
| POST   | `/api/content-categories`                 | `approval_policy.manage` | Creates a group category. Returns `201`.                                           |
| PATCH  | `/api/content-categories/:id`             | `approval_policy.manage` | Renames or archives a category.                                                    |
| GET    | `/api/approval-policies?companyId=<uuid>` | `content.read`           | Lists policies. The query is optional; scope is still enforced.                    |
| PUT    | `/api/approval-policies`                  | `approval_policy.manage` | Creates or replaces a company/category policy. Requires recent SSO authentication. |
| DELETE | `/api/approval-policies/:id`              | `approval_policy.manage` | Removes a policy and returns `204`. Requires recent SSO authentication.            |

Policy changes are audited. A submitted approval request keeps the policy snapshot that was used when it was submitted; changing a policy later does not silently change a request already waiting for a decision.
