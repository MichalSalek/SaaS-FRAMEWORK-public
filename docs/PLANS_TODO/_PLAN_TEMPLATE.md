# Plan: [NAME] ([ID])

> Date created: YYYY-MM-DD | Priority: CRITICAL/HIGH/MEDIUM/LOW
> Status: PENDING
> Effort: ~X hours/days
> Dependency: [what must be DONE before this plan starts]

## DOCUMENTATION CASCADE (after the plan is finished)

> **MANDATORY: READ BEFORE IMPLEMENTING.** These updates are part of "done".

1. **`_MASTER_IMPLEMENTATION_INDEX.md`**: change the status to `DONE` plus the date (roadmap and active plans)
2. **Domain docs**: update the documents that mention the problems this plan solves
3. **Changelog**: add an entry with a summary
4. **Delete** this plan file (git history keeps it)

> Fill in the CONCRETE files and sections to update:
- [ ] `_MASTER_IMPLEMENTATION_INDEX.md`, row [ID]: status to DONE
- [ ] [other files, for example the launch checklist or `.shared-kernel/domain/routing/routing.config.ts`]

---

## Goal

[What we are doing and why. Two or three sentences.]

## Prerequisites

[What the executor MUST verify or read BEFORE starting:]
1. [file or command to verify]
2. [source of truth or playbook to read]

## Scope

### Step 1: [Step name]

- [ ] [Concrete action with a file or path]
- [ ] [Next action]

### Step 2: [Step name]

- [ ] [...]

## Acceptance Criteria

- [ ] `npm run typecheck`: zero errors (main/ and web-1/)
- [ ] Build succeeds for both apps (`npm run build:production`)
- [ ] [Criteria specific to the plan]

## References

- [links to sources of truth, the playbook, prototypes, domain docs]

## Execution Notes

**Delegation:** [Sequential or parallel. Which steps can run side by side.]
**Risk:** [What can go wrong.]
