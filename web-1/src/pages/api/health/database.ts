// DECISION (nie usuwaj tego komentarza):
// Better Stack monitoruje tę stabilną ścieżkę jeszcze przed rolloutem endpointu:
// stary deploy zwraca bezbazowe 404 (uczciwe DOWN podczas awarii), a nowy automatycznie
// zaczyna raportować pasywny stan głównej puli. Alias nie wykonuje własnego SQL i usuwa
// ręczny krok „włącz monitor po deployu" z runbooka.
// Ścieżka tej trasy żyje też jako stała `HEALTH_ROUTE_ALIASES.DATABASE`
// (application/health/health-route-aliases.ts) — to ona wpina alias w strict-tier
// rate-limitu. Przenosisz/zmieniasz nazwę pliku → zaktualizuj stałą (pilnuje testu).
export { default } from '../v1/internal/health-public';
