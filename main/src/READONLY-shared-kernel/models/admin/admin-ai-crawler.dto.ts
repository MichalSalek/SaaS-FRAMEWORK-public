import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type {
  AiCrawlerListQuery,
  AiCrawlerListResponse,
  AiCrawlerStatsResponse,
} from '../../domain/admin/ai-crawler.types';

export type AdminAiCrawlerDtoApi = {
  /** Zwraca zagregowane statystyki wizyt crawlerów AI z ostatnich 30 dni (wg bota, dnia, ścieżki, kategorii). */
  ADMIN_AI_CRAWLER_STATS: {
    REQUEST: undefined;
    RESPONSE: AiCrawlerStatsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<undefined>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      undefined,
      AiCrawlerStatsResponse,
      DetailedErrorPayload<undefined>
    >;
  };

  /** Zwraca stronicowaną listę surowych zdarzeń crawlerów AI z filtrami (bot, kategoria, ścieżka, zakres dat). */
  ADMIN_AI_CRAWLER_LIST: {
    REQUEST: Partial<AiCrawlerListQuery>;
    RESPONSE: AiCrawlerListResponse;
    RESPONSE_ERROR: DetailedErrorPayload<Partial<AiCrawlerListQuery>>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      Partial<AiCrawlerListQuery>,
      AiCrawlerListResponse,
      DetailedErrorPayload<Partial<AiCrawlerListQuery>>
    >;
  };
};
