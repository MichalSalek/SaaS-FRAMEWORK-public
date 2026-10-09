# Audit System Changelog

> 📍 **Nawigacja:** [tests/README.md](../README.md) → [audit/README.md](README.md) → Ten dokument

## [1.1.0] - 2026-05-30

### Changed — all 19 audits now run in `run-all.sh` (was 16)

The 3 previously-commented audits were redesigned to be **deterministic and non-fragile** before wiring into `run-all.sh`:

- **docs-ssot** — narrowed to PRODUCTION CODE only. Dropped `docs/` scanning (the source of false-positives and a rotting per-file exception list). Keeps: stale domain/email/brand in code, satellite SSOT headers, and the placeholder launch guard.
- **events-i18n-parity** — fixed dead `LOCALES_DIR` path (i18n moved to `main/src/locales`) and redesigned from "every event must be translated" to **LOCALE PARITY** (pl/en/de key sets must match). No fragile user-facing/internal list.
- **pagination-tiebreaker** — wired in as-is (already passing; advisory heuristic, now enforced).

### Added
- Named npm scripts: `audit:events-i18n`, `audit:pagination`.

### Removed
- Standalone-only category (0 remaining). README + root `audit` echo updated.

## [1.0.0] - 2026-01-15

### Initial Release

**Created comprehensive audit system for architecture consistency validation.**

#### New Audits Added

1. **SSOT Routes Audit** (`ssot-routes.sh`)
   - Validates routing.config.ts consistency with API endpoints
   - Detects orphaned endpoints and missing route definitions
   - Ensures route pattern compliance

2. **SSOT Events Audit** (`ssot-events.sh`)
   - Verifies CQRS event system integrity
   - Checks event handlers exist for all defined events
   - Validates event naming conventions

3. **Permissions Audit** (`permissions.sh`)
   - Ensures all routes have permission definitions
   - Validates role-based access control completeness
   - Detects missing permission mappings

4. **DTO Completeness Audit** (`dto-completeness.sh`)
   - Validates data transfer object consistency
   - Ensures all endpoints have proper type definitions
   - Checks request/response type completeness

5. **Validation Coverage Audit** (`validation-coverage.sh`)
   - Verifies input validation completeness
   - Ensures all POST endpoints have validation policies
   - Detects unvalidated user inputs

6. **i18n Coverage Audit** (`i18n-coverage.sh`)
   - Validates internationalization completeness
   - Checks for hardcoded strings in UI components
   - Ensures translation key coverage

7. **Kernel Sync Audit** (`kernel-sync.sh`)
   - Validates shared-kernel distribution
   - Detects version mismatches between repositories
   - Ensures kernel dependencies are synchronized

8. **Imports Health Audit** (`imports-health.sh`)
   - Validates import structure and module boundaries
   - Forbids READONLY-shared-kernel imports inside .shared-kernel
   - Blocks cross-imports between main/ and web-1/ (must go via .shared-kernel)
   - Enforces Prisma SSOT (no direct prisma/js-client value imports), no db_models.dto barrel, email-transport facade
   - NOTE: circular/value-cycle detection is NOT done here — see `circular-imports.sh` (main/src) and `circular-deps.sh` (web-1/src), both madge-based with alias resolution.

#### Infrastructure

- **Run-All Script** (`run-all.sh`): Orchestrates all audits with summary reporting
- **Utilities** (`_utils.sh`): Shared functions for consistent output formatting
- **NPM Scripts**: Integration with package.json for easy execution
- **Documentation**: Comprehensive README and integration guides

#### Features

- **Colored Output**: Success (green), error (red), warning (yellow), info (blue)
- **Exit Codes**: 0 for success, 1 for failures
- **Summary Reporting**: Pass/fail counts and detailed results
- **Modular Design**: Each audit is independent and can be run separately
- **Performance Optimized**: Fast execution suitable for CI/CD integration

#### Integration

- Added audit commands to main package.json
- Integrated with existing project documentation (AGENTS.md, CLAUDE.md)
- Designed for pre-commit hooks and CI/CD pipelines
- Compatible with existing development workflow

#### Quality Assurance

- All audits tested against current codebase
- Validated output formatting and error handling
- Confirmed integration with existing npm scripts
- Documented troubleshooting procedures

---

**Total Files Created:** 10  
**Total Lines of Code:** ~1,200  
**Test Coverage:** Manual validation against production codebase  
**Documentation:** Complete with examples and troubleshooting