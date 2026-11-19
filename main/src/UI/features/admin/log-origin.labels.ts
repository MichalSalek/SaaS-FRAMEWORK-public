// Readable names for a log row's layer and environment. Both columns are plain
// text in the database, so a historic row may carry a value outside today's
// lists: such a value is shown as stored, never as a translation key.
import type { useTranslations } from 'next-intl';
import {
  LOG_APPLICATIONS,
  LOG_ENVIRONMENTS,
  type LogEnvironment,
} from '@kernel/domain/admin/log-triage.config';

type LogsTranslator = ReturnType<typeof useTranslations<'admin.logs'>>;

const isLogApplication = (
  value: string
): value is (typeof LOG_APPLICATIONS)[number] =>
  (LOG_APPLICATIONS as readonly string[]).includes(value);

const isLogEnvironment = (value: string): value is LogEnvironment =>
  (LOG_ENVIRONMENTS as readonly string[]).includes(value);

export const logApplicationLabel = (
  application: string,
  t: LogsTranslator
): string =>
  isLogApplication(application) ? t(`application_${application}`) : application;

export const logEnvironmentLabel = (
  environment: string,
  t: LogsTranslator
): string =>
  isLogEnvironment(environment) ? t(`environment_${environment}`) : environment;
