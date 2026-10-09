// UI/features/admin/AdminEmailPreviewPage.composition.tsx
// Admin read-only preview of every outgoing email template (incl. magic-link),
// rendered by the production renderer with sample data, PL/EN/DE + desktop/mobile.
// Owner polishes templates visually. The pickers are shared parts (SelectAtom,
// SegmentedControlMolecule); the mail itself is CONTENT in its own frame.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowClockwiseIcon,
  DesktopIcon,
  DeviceMobileIcon,
  EnvelopeSimpleIcon,
} from '@phosphor-icons/react';
import {
  EMAIL_PREVIEW_TEMPLATES,
  type EmailPreviewGroup,
} from '@kernel/domain/email/email-preview.catalog';
import {
  I18N_CONFIG,
  LOCALE_SHORT_LABELS,
  type LocaleType,
} from '@kernel/domain/i18n/i18n.config';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  HeroCountPillAtom,
  HeroCountPillRowAtom,
} from '../../components/HeroCountPill/HeroCountPill.atom';
import { SelectAtom } from '../../components/Select/Select.atom';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { useAdminEmailPreview } from './hooks/useAdminEmailPreview';
import styles from './AdminEmailPreviewPage.module.css';

type Viewport = 'desktop' | 'mobile';

const GROUP_ORDER: readonly EmailPreviewGroup[] = [
  'auth',
  'onboarding',
  'trial',
  'billing',
  'pairing',
  'account',
  'newsletter',
];

/**
 * Height of the mail's own document, so the frame ends where the mail ends
 * (CSS caps it at the frame's maximum; a longer mail scrolls inside).
 *
 * DECISION (nie usuwaj tego komentarza): ramka ma `sandbox='allow-same-origin'`
 * i NIC więcej. Bez tego dokument maila jest obcym originem i jego wysokości
 * nie da się odczytać, więc krótki mail zostawiał pod sobą pusty pas. Skrypty,
 * formularze i nawigacja okna nadal są zablokowane (brak `allow-scripts`),
 * a sama treść to nasz własny szablon wyrenderowany przez backend.
 */
function useMailHeight() {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  // Kept across templates: the next mail's skeleton stands in the last
  // mail's height instead of jumping to the maximum and back.
  const [height, setHeight] = useState<number | null>(null);

  const measure = () => {
    observerRef.current?.disconnect();
    const root = frameRef.current?.contentDocument?.documentElement;
    if (!root) {
      return;
    }
    const read = () =>
      setHeight(Math.ceil(root.getBoundingClientRect().height));
    read();
    // The mail reflows when the frame's width changes (desktop / mobile).
    observerRef.current = new ResizeObserver(read);
    observerRef.current.observe(root);
  };

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { frameRef, height, measure };
}

export function AdminEmailPreviewPageComposition() {
  const t = useTranslations('admin.emailPreview');

  const [templateId, setTemplateId] = useState<string>(
    EMAIL_PREVIEW_TEMPLATES[0]?.id ?? 'welcome'
  );
  const [locale, setLocale] = useState<LocaleType>(I18N_CONFIG.defaultLocale);
  const [viewport, setViewport] = useState<Viewport>('desktop');

  const { preview, isLoading, isFetching, isError, refetch } =
    useAdminEmailPreview(templateId, locale);
  const { frameRef, height, measure } = useMailHeight();
  const frameStyle =
    height === null
      ? undefined
      : ({ '--mail-height': `${height}px` } as CSSProperties);

  // One flat list in catalogue order, each id led by its group name (the
  // shared select has no option groups).
  const templateOptions = useMemo(
    () =>
      GROUP_ORDER.flatMap(group =>
        EMAIL_PREVIEW_TEMPLATES.filter(spec => spec.group === group).map(
          spec => ({
            value: spec.id,
            label: `${t(`group.${group}`)}: ${spec.id}`,
          })
        )
      ),
    [t]
  );

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('title')}
      subtitle={t('subtitle')}
      actions={
        <ButtonAtom
          size='sm'
          variant='outlined'
          icon={<ArrowClockwiseIcon size={14} />}
          loading={isFetching}
          onClick={() => void refetch()}>
          {t('refresh')}
        </ButtonAtom>
      }
      meta={
        <HeroCountPillRowAtom>
          <HeroCountPillAtom
            icon={<EnvelopeSimpleIcon size={13} weight='fill' />}>
            {t('metaTemplateCount', { count: EMAIL_PREVIEW_TEMPLATES.length })}
          </HeroCountPillAtom>
        </HeroCountPillRowAtom>
      }>
      <div className={styles.toolbar}>
        <SelectAtom
          className={styles.templateField}
          label={t('templateLabel')}
          options={templateOptions}
          value={templateId}
          onChange={event => setTemplateId(event.target.value)}
        />

        <div className={styles.field}>
          <span className={styles.fieldLabel} aria-hidden='true'>
            {t('localeLabel')}
          </span>
          <div className={styles.fieldControl}>
            <SegmentedControlMolecule
              semantics='radio'
              size='sm'
              shape='control'
              ariaLabel={t('localeLabel')}
              value={locale}
              onChange={setLocale}
              options={I18N_CONFIG.locales.map(loc => ({
                value: loc,
                label: LOCALE_SHORT_LABELS[loc],
              }))}
            />
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel} aria-hidden='true'>
            {t('viewportLabel')}
          </span>
          <div className={styles.fieldControl}>
            <SegmentedControlMolecule
              semantics='radio'
              size='sm'
              shape='control'
              ariaLabel={t('viewportLabel')}
              value={viewport}
              onChange={setViewport}
              options={[
                {
                  value: 'desktop',
                  label: t('viewportDesktop'),
                  icon: <DesktopIcon size={15} weight='regular' />,
                },
                {
                  value: 'mobile',
                  label: t('viewportMobile'),
                  icon: <DeviceMobileIcon size={15} weight='regular' />,
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* ONE box: the subject line, then the mail in its own frame. */}
      <section
        className={styles.panel}
        aria-label={t('frameTitle')}
        // On the panel: that is where the frame's height is computed.
        style={frameStyle}>
        <p className={styles.subject}>
          <span className={styles.subjectLabel}>{t('subjectLabel')}</span>
          <span className={styles.subjectValue}>
            {isLoading ? (
              <SkeletonAtom variant='text' width='16rem' height='1lh' />
            ) : (
              (preview?.subject ?? null)
            )}
          </span>
        </p>

        {/* A failed refresh keeps the last render under the error. */}
        {isError && (
          <div className={preview ? undefined : styles.stageState}>
            <ErrorStateMolecule
              size='inline'
              message={t('loadError')}
              retryLabel={t('retry')}
              onRetry={() => void refetch()}
              isRetrying={isFetching}
            />
          </div>
        )}

        {(preview !== null || !isError) && (
          <div
            className={styles.frameWrap}
            data-viewport={viewport}
            aria-busy={preview === null}>
            {preview !== null ? (
              <iframe
                key={`${templateId}-${locale}`}
                ref={frameRef}
                className={styles.frame}
                title={t('frameTitle')}
                sandbox='allow-same-origin'
                onLoad={measure}
                srcDoc={preview.html}
              />
            ) : (
              // Height through the prop (inline): a class from this module
              // and the skeleton's own have equal specificity.
              <SkeletonAtom
                variant='rect'
                height='var(--preview-frame-height)'
              />
            )}
          </div>
        )}
      </section>
    </AdminPageLayoutComposition>
  );
}
