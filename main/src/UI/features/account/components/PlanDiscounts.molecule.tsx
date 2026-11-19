import { useTranslations } from 'next-intl';
import type { SubscriptionDiscountSummary } from '@kernel/models/session/session.dto';
import { useCurrentLang } from '../../../hooks/useCurrentLang';
import { formatDateLong } from '../../../../application/date/date.utils';
import { formatPlanCharge } from '../AccountPlan.helpers';

export function PlanDiscountsMolecule({
  discounts,
}: {
  discounts: SubscriptionDiscountSummary[] | undefined;
}) {
  const t = useTranslations('account.planDiscount');
  const lang = useCurrentLang();
  return (
    <>
      {discounts?.map((discount, index) => {
        const value =
          discount.percentOff !== null
            ? new Intl.NumberFormat(lang, {
                style: 'percent',
                maximumFractionDigits: 2,
              }).format(discount.percentOff / 100)
            : formatPlanCharge(discount.amountOff, discount.currency, lang);
        if (value === null) {
          return null;
        }
        const duration =
          discount.duration === 'forever'
            ? 'forever'
            : discount.duration === 'once'
              ? 'once'
              : discount.endsAt
                ? 'until'
                : 'limited';
        return (
          <p key={`${discount.name ?? ''}:${index}`}>
            {discount.name && <strong>{discount.name}: </strong>}
            {t(duration, {
              value,
              date: discount.endsAt
                ? formatDateLong(discount.endsAt, lang).replaceAll(
                    ' ',
                    '\u00a0'
                  )
                : '',
            })}
          </p>
        );
      })}
    </>
  );
}
