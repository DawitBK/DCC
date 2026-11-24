import { ApiRequestError } from './browser-api';

/**
 * Forms are checked with the SAME zod schemas the API uses (`@dcc/contracts`), so a limit, a required
 * field or an enum can never differ between the screen and the server. Nothing here copies a rule.
 */
type Issue = {
  path: ReadonlyArray<PropertyKey>;
  message: string;
  code?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
};
type Schema<T> = {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<Issue> } };
};

/**
 * zod's own wording ("Too small: expected array to have >=1 items") is not for people. The common cases are said
 * plainly; anything else keeps the schema's message (a schema that wants its own words sets them in the contract).
 */
function plainMessage(issue: Issue): string {
  if (issue.code === 'too_small' && issue.origin === 'string' && Number(issue.minimum) <= 1)
    return 'This is required.';
  if (issue.code === 'too_small' && issue.origin === 'array' && Number(issue.minimum) <= 1)
    return 'Choose at least one.';
  if (issue.code === 'too_big' && issue.origin === 'string' && issue.maximum !== undefined)
    return `Use at most ${String(issue.maximum)} characters.`;
  if (issue.code === 'invalid_type' && /received undefined/.test(issue.message))
    return 'This is required.';
  return issue.message;
}

/** Message per field name. A problem that belongs to no field is under `_form`. */
export type FieldErrors = Record<string, string>;

export function validate<T>(
  schema: Schema<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length ? String(issue.path[0]) : '_form';
    errors[field] ??= plainMessage(issue);
  }
  return { ok: false, errors };
}

/** The API's own field problems (a 400 with `issues`), in the same shape as `validate`. */
export function fieldErrorsFromApi(error: unknown): FieldErrors {
  if (!(error instanceof ApiRequestError)) return {};
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path ? issue.path.split('.')[0]! : '_form';
    errors[field] ??= issue.message;
  }
  return errors;
}

/** An empty form box means "not given": optional fields must be left out, not sent as ''. */
export function blankToUndefined<T extends Record<string, unknown>>(values: T): T {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    ]),
  ) as T;
}

/** The longest text a schema field accepts, read from the schema itself (for counters and `maxLength`). */
export function maxLengthOf(field: unknown): number | undefined {
  const max = (field as { maxLength?: number | null } | null)?.maxLength;
  return typeof max === 'number' ? max : undefined;
}
