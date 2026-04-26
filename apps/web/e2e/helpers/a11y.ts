import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Run an accessibility scan on the current page using axe-core's WCAG 2.0 +
 * 2.1 rules at A and AA levels.
 *
 * Policy:
 *   - `critical` and `serious` violations FAIL the test.
 *   - `moderate` and `minor` violations are logged via `console.warn` but
 *     don't fail. This keeps the suite green on first introduction (we don't
 *     want a backlog of design-debt items blocking PRs) while still catching
 *     genuine regressions in keyboard nav, contrast on focus, missing labels,
 *     etc.
 *
 * Tighten by lowering the threshold once the baseline is clean.
 *
 * `color-contrast` is disabled by default — design tokens are still being
 * tuned and the violations are noisy. Re-enable per-test via
 * `runA11yScan(page, { enableContrast: true })` once a design pass cleans up
 * placeholder/secondary text contrast.
 */
const DEFAULT_DISABLED_RULES = ['color-contrast'];

export async function runA11yScan(
  page: Page,
  options: {
    /** Restrict the scan to a CSS selector (e.g. just one panel). */
    include?: string;
    /** Additional rules to skip on top of the defaults. */
    disableRules?: string[];
    /** Re-enable color-contrast for this scan (default disabled). */
    enableContrast?: boolean;
  } = {}
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
  ]);

  const disabled = [
    ...(options.enableContrast ? [] : DEFAULT_DISABLED_RULES),
    ...(options.disableRules ?? []),
  ];

  if (options.include) {
    builder = builder.include(options.include);
  }
  if (disabled.length) {
    builder = builder.disableRules(disabled);
  }

  const results = await builder.analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  );
  const advisory = results.violations.filter(
    (v) => v.impact !== 'critical' && v.impact !== 'serious'
  );

  if (advisory.length > 0) {
    console.warn(
      `[a11y] ${advisory.length} non-blocking violation(s):\n` +
        advisory
          .map((v) => `  - [${v.impact}] ${v.id}: ${v.help}`)
          .join('\n')
    );
  }

  if (blocking.length > 0) {
    const summary = blocking
      .map(
        (v) =>
          `  - [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`
      )
      .join('\n');
    expect(
      blocking,
      `${blocking.length} blocking accessibility violation(s):\n${summary}`
    ).toEqual([]);
  }
}
