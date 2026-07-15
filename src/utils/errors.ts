// `catch` clause variables are typed `unknown`, not `any` — narrow once here
// instead of typing every catch site `(e: any)` and writing `e?.message ?? e`
// by hand.
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
