import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import {
  ContentReportStatusValue,
  SupportSenderTypeValue,
} from '@kernel/models/db_models.generated.dto';
import { TEST_USERS_CONFIG } from '@kernel/config/test-users.config';
import { NEWSLETTER_CONSENT_ACTION } from '@kernel/domain/newsletter/newsletter-consent.types';
import type { DemoStylistAnchor } from './demo-content-seeding.community';
import { photoRecordId } from './demo-content-seeding.community-relations';
import {
  DEMO_COMMUNITY_ANNOUNCEMENTS,
  DEMO_COMMUNITY_CONTENT_REPORTS,
  DEMO_COMMUNITY_NEWSLETTER,
  DEMO_COMMUNITY_SUPPORT_THREADS,
} from './demo-content-seeding.community-extras-data';

const DAY_MS = TIME.MS_PER_DAY;

/**
 * Zaplecze wystawy demo: support, moderacja, komunikaty, newsletter. Każdy
 * blok to find-or-create po stabilnym kluczu (email+temat, zgłaszająca+zdjęcie,
 * tytuł, email) i tworzy wiersze wyłącznie przy pierwszym runie, więc ręczne
 * odpowiedzi admina z panelu przeżywają kolejny seed.
 */
export const seedCommunityExtras_IO = async ({
  now,
  results,
  stylists,
}: {
  now: Date;
  results: string[];
  stylists: Map<string, DemoStylistAnchor>;
}): Promise<void> => {
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const emails = [
    ...DEMO_COMMUNITY_SUPPORT_THREADS.map(t => t.userEmail),
    ...DEMO_COMMUNITY_CONTENT_REPORTS.map(r => r.reporterEmail),
    TEST_USERS_CONFIG.ADMIN.email,
  ];
  const users = await DB_CLIENT.use.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true },
  });
  const userIdByEmail = new Map(users.map(u => [u.email, u.id]));

  // ── Support: po jednym wątku w statusie OPEN / RESOLVED / CLOSED ──────────
  let threadsCreated = 0;
  for (const spec of DEMO_COMMUNITY_SUPPORT_THREADS) {
    const userId = userIdByEmail.get(spec.userEmail);
    if (!userId) {
      continue;
    }
    const existing = await DB_CLIENT.use.supportThread.findFirst({
      where: { user_id: userId, subject: spec.subject },
      select: { id: true },
    });
    if (existing) {
      continue;
    }
    const startedAt = daysAgo(spec.daysAgo);
    await DB_CLIENT.use.supportThread.create({
      data: {
        user_id: userId,
        subject: spec.subject,
        status: spec.status,
        created_at: startedAt,
        messages: {
          // Rozsunięte created_at: identyczny timestamp odwracał kolejność
          // pytania i odpowiedzi (lekcja z wątku Karoliny, S111).
          create: spec.messages.map((message, index) => ({
            sender_type: message.fromSupport
              ? SupportSenderTypeValue.SUPPORT
              : SupportSenderTypeValue.USER,
            content: message.content,
            created_at: new Date(
              startedAt.getTime() + index * 5 * TIME.MS_PER_HOUR
            ),
          })),
        },
      },
    });
    threadsCreated++;
  }
  if (threadsCreated > 0) {
    results.push(`Demo support threads created (${threadsCreated})`);
  }

  // ── Moderacja: zgłoszenie oczekujące i odrzucone ──────────────────────────
  const adminId = userIdByEmail.get(TEST_USERS_CONFIG.ADMIN.email) ?? null;
  const reportRows = DEMO_COMMUNITY_CONTENT_REPORTS.flatMap(spec => {
    const reporterId = userIdByEmail.get(spec.reporterEmail);
    const stylist = stylists.get(spec.stylistSlug);
    const recordId = stylist ? photoRecordId(stylist, spec.photo) : undefined;
    if (!reporterId || !recordId) {
      return [];
    }
    const resolved = spec.status !== ContentReportStatusValue.PENDING;
    return [
      {
        reporter_id: reporterId,
        gallery_record_id: recordId,
        reason: spec.reason,
        status: spec.status,
        description: spec.description,
        admin_note: spec.adminNote ?? null,
        resolved_by_id: resolved ? adminId : null,
        created_at: daysAgo(spec.daysAgo),
        resolved_at: resolved ? daysAgo(spec.daysAgo - 1) : null,
      },
    ];
  });
  // Zgłoszenie z poprzedniego zestawu danych (inne zdjęcie tej samej
  // zgłaszającej) zostawiłoby w kolejce admina duplikat, a zgłoszenia nie mają
  // klucza unikalnego — kasujemy więc wszystko spoza aktualnej specyfikacji.
  const demoReporterIds = DEMO_COMMUNITY_CONTENT_REPORTS.flatMap(spec => {
    const id = userIdByEmail.get(spec.reporterEmail);
    return id ? [id] : [];
  });
  // DECISION (nie usuwaj tego komentarza) — `AND` Z `NOT` W SRODKU, NIE `NOT` Z TABLICA:
  // `NOT: [A, B]` sklada sie w Prismie w JEDEN warunek (`NOT (A AND B)`), wiec przy
  // dwoch roznych zgloszeniach zaden wiersz nie spelnia obu naraz, negacja jest
  // prawdziwa ZAWSZE i kasowaly sie rowniez te zgloszenia, ktore wlasnie sa
  // w specyfikacji. Zamierzone „skasuj wszystko SPOZA specyfikacji" to koniunkcja
  // osobnych negacji. Pusta specyfikacja nie kasuje nic — brak wierszy do zachowania
  // znaczy „nie ma czego porownywac", nie „skasuj wszystko".
  if (demoReporterIds.length > 0 && reportRows.length > 0) {
    await DB_CLIENT.use.contentReport.deleteMany({
      where: {
        reporter_id: { in: demoReporterIds },
        AND: reportRows.map(r => ({
          NOT: {
            reporter_id: r.reporter_id,
            gallery_record_id: r.gallery_record_id,
          },
        })),
      },
    });
  }

  if (reportRows.length > 0) {
    // Brak @@unique na zgłoszeniu (re-report po rozpatrzeniu jest legalny),
    // więc klucz idempotencji (zgłaszająca, zdjęcie) sprawdzamy sami.
    const existingReports = await DB_CLIENT.use.contentReport.findMany({
      where: {
        OR: reportRows.map(r => ({
          reporter_id: r.reporter_id,
          gallery_record_id: r.gallery_record_id,
        })),
      },
      select: { reporter_id: true, gallery_record_id: true },
    });
    const existingKeys = new Set(
      existingReports.map(r => `${r.reporter_id}|${r.gallery_record_id}`)
    );
    const missing = reportRows.filter(
      r => !existingKeys.has(`${r.reporter_id}|${r.gallery_record_id}`)
    );
    if (missing.length > 0) {
      await DB_CLIENT.use.contentReport.createMany({ data: missing });
      results.push(`Demo content reports created (${missing.length})`);
    }
  }

  // ── Komunikaty (bez żadnego aktywnego teraz, DECISION w pliku danych) ─────
  const existingAnnouncements = await DB_CLIENT.use.announcement.findMany({
    where: { title: { in: DEMO_COMMUNITY_ANNOUNCEMENTS.map(a => a.title) } },
    select: { title: true },
  });
  const existingTitles = new Set(existingAnnouncements.map(a => a.title));
  const missingAnnouncements = DEMO_COMMUNITY_ANNOUNCEMENTS.filter(
    a => !existingTitles.has(a.title)
  );
  if (missingAnnouncements.length > 0) {
    await DB_CLIENT.use.announcement.createMany({
      data: missingAnnouncements.map(a => ({
        title: a.title,
        message: a.message,
        type: a.type,
        is_active: a.isActive,
        starts_at: a.startsDaysAgo === null ? null : daysAgo(a.startsDaysAgo),
        ends_at: a.endsDaysAgo === null ? null : daysAgo(a.endsDaysAgo),
        created_by_user_id: adminId,
        created_at: daysAgo(a.startsDaysAgo ?? 3),
      })),
    });
    results.push(`Demo announcements created (${missingAnnouncements.length})`);
  }

  // ── Newsletter: aktywna subskrypcja i wypisana (z audytem zgód) ───────────
  const existingSubscribers = await DB_CLIENT.use.newsletterSubscriber.findMany(
    {
      where: { email: { in: DEMO_COMMUNITY_NEWSLETTER.map(n => n.email) } },
      select: { email: true },
    }
  );
  const existingSubscriberEmails = new Set(
    existingSubscribers.map(s => s.email)
  );
  for (const spec of DEMO_COMMUNITY_NEWSLETTER) {
    if (existingSubscriberEmails.has(spec.email)) {
      continue;
    }
    const subscribedAt = daysAgo(spec.subscribedDaysAgo);
    const unsubscribedAt =
      spec.unsubscribedDaysAgo === null
        ? null
        : daysAgo(spec.unsubscribedDaysAgo);
    // Zdarzenia zgód powstają TYLKO razem z subskrybentem: tabela jest
    // append-only (RODO art. 30), więc kolejny run niczego do niej nie dopisuje.
    await DB_CLIENT.use.newsletterSubscriber.create({
      data: {
        email: spec.email,
        created_at: subscribedAt,
        is_active: unsubscribedAt === null,
        confirmed_at: new Date(
          subscribedAt.getTime() + 10 * TIME.MS_PER_MINUTE
        ),
        consent_timestamp: subscribedAt,
        consent_source: spec.source,
        consent_events: {
          create: [
            {
              action: NEWSLETTER_CONSENT_ACTION.SUBSCRIBE,
              consent_timestamp: subscribedAt,
            },
            ...(unsubscribedAt
              ? [
                  {
                    action: NEWSLETTER_CONSENT_ACTION.UNSUBSCRIBE,
                    consent_timestamp: unsubscribedAt,
                  },
                ]
              : []),
          ],
        },
      },
    });
    results.push(`Demo newsletter subscriber created (${spec.email})`);
  }
};
