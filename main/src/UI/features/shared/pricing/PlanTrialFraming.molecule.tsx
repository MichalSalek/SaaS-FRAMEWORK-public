/**
 * Trial-framing (price antipattern, owner): the entry offer (e.g. „Darmowy okres
 * próbny 0”) leads, followed by the full and readable post-trial amount. Currency
 * and annual charge are supplied by each caller from live prices.
 * One DOM shape (lede <p> + after <p>) shared by /pricing and both LP mini-pricings.
 *
 * DECISION:
 * - Returns a FRAGMENT so both <p> stay direct children of the parent: on /pricing that
 *   is the `.tierCard` subgrid, whose tracks align rows across cards; a <div> breaks it.
 * - i18n-dumb and className-parametrized: each surface injects its own strings/classes.
 * - `renderAfter === null` renders a hard space so the subgrid track keeps its row (an
 *   empty <p> collapses).
 * - The post-trial amount is BOLD, owned here: callers get the `<amount>` tag renderer
 *   for the `trialPriceAfter*` keys (a tag without a renderer is a next-intl error). (owner)
 */
import type { ReactNode } from 'react';
import styles from './PlanTrialFraming.module.css';

/** Renderer of the rich-text `<amount>` tag (the shape of next-intl's `t.rich`). */
type AmountTag = (chunks: ReactNode) => ReactNode;

const amountTag: AmountTag = chunks => (
  <strong className={styles.amount}>{chunks}</strong>
);

interface PlanTrialFramingProps {
  /** Hero heading (large print): the entry offer, not the price. */
  ledeText: string;
  /**
   * The post-trial statement is resolved through the caller's i18n, including
   * the selected currency and annual total where relevant. The caller passes the
   * received `amount` to `t.rich(key, { price, amount })`. `null` -> a hard
   * space (Free / Scale / no Stripe price) so row alignment survives.
   */
  renderAfter: ((amount: AmountTag) => ReactNode) | null;
  ledeClassName?: string;
  afterClassName?: string;
}

export function PlanTrialFramingMolecule({
  ledeText,
  renderAfter,
  ledeClassName,
  afterClassName,
}: PlanTrialFramingProps) {
  return (
    <>
      <p className={ledeClassName}>{ledeText}</p>
      <p className={afterClassName}>
        {renderAfter ? renderAfter(amountTag) : ' '}
      </p>
    </>
  );
}
