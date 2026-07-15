export const SURFACES = ['vscode', 'pycharm', 'jupyter'] as const;

export type Surface = (typeof SURFACES)[number];

/** Resolve the surface used for lazy attachment. It never restricts switching. */
export function resolvePreferredSurface(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): Surface | undefined {
  const flag = argv.find((arg) => arg.startsWith('--surface='));
  const raw = flag?.slice('--surface='.length) || env.LEMMA_SURFACE;
  if (!raw) return undefined;
  if ((SURFACES as readonly string[]).includes(raw)) return raw as Surface;
  throw new Error(`Invalid preferred Lemma surface "${raw}". Expected one of: ${SURFACES.join(', ')}.`);
}
