# Abenezer: requirements and data collection

Your area: `docs/requirements/`, `docs/discovery/`, `docs/onboarding/`. You do not need to run any code to do your work (you can if you want to understand the product).
**Important:** this repository is public. The _templates, structure and your findings in general terms_ go here; **real names, real accounts and real company data do not**.

## Read first

1. [README](../../README.md) (what DCC is) and [OWNERSHIP](OWNERSHIP.md), especially "Real organisational data does NOT go in this repository".
2. The DCC proposal and team document (from Dawit): section 3 of the team document is your scope.
3. [PROPOSAL-REVIEW](../requirements/PROPOSAL-REVIEW.md): ambiguities and gaps found in the proposal. **Resolving these with stakeholders is your first job.**
4. The templates in `docs/discovery/` and `docs/requirements/`.

## Where real data lives

Ask Dawit where the private store is (decision D-02: a restricted shared drive or a private repository). Keep inventories there. Never collect or circulate **passwords**
in spreadsheets or documents; the account template has no password column on purpose. Account access is transferred through each network's own secure process.

## Your first tasks (details in [BACKLOG](../project/BACKLOG.md))

| ID   | Task                                                                                                                               | Output                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A-01 | Group and subsidiary structure: companies, business units, departments, brands                                                     | filled `ORGANISATION-STRUCTURE` template (private) + a summary here with no personal data |
| A-02 | Social media account inventory for every account (all fields in the template, **no passwords**)                                    | `ACCOUNT-INVENTORY` (private) + counts and gaps summary here                              |
| A-03 | Stakeholder and user inventory: who will use DCC, in which role                                                                    | `STAKEHOLDERS` (private)                                                                  |
| A-04 | Current-state process documentation: how content is made, reviewed, approved, published; escalation; incidents                     | `docs/requirements/CURRENT-PROCESSES.md`                                                  |
| A-05 | Approval matrix and publishing policy requirements, per company and for the Group (the proposal has a starting matrix to validate) | `docs/requirements/APPROVAL-AND-PUBLISHING-POLICY.md`                                     |
| A-06 | Requirements and decisions register: close the items in PROPOSAL-REVIEW; keep the register current                                 | `docs/requirements/REQUIREMENTS-REGISTER.md`, `DECISIONS-REGISTER.md`                     |

Hirko and Rahel build from what you write, so be specific: _who_, _what_, _how many levels_, _how long may a review take_. When a stakeholder has not decided something, record it as an open
question with the person who must decide: do not fill the gap yourself. Coordinate with Dawit so what you find shapes the architecture.
