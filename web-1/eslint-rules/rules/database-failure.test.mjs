// @vitest-environment node
import guard from './database-failure.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const inline = [{ messageId: 'inline' }];
const wrap = body =>
  `export const f = async (id: string) => {\n  try {\n    await run(id);\n  } ${body}\n  return success(1);\n};`;

tester.run('nf/database-failure', guard.rule, {
  valid: [
    wrap("catch (error) {\n    return databaseFailure('f', error);\n  }"),
    // other failure types inside a catch
    wrap(
      "catch (error) {\n    if (isP2002(error)) { return failure({ type: 'CONFLICT' }); }\n    return databaseFailure('f', error);\n  }"
    ),
    // function scope: no error in scope
    "export const f = async (id: string) => {\n  if (!id) {\n    return failure({ type: 'DATABASE_ERROR', operation: 'f' });\n  }\n  return success(1);\n};",
    // the try block itself is not the catch
    wrap(
      "catch (error) {\n    return databaseFailure('f', error);\n  }"
    ).replace(
      'await run(id);',
      "if (x) { return failure({ type: 'DATABASE_ERROR', operation: 'f' }); }"
    ),
    // a type that only mentions DATABASE_ERROR
    wrap(
      "catch (error) {\n    const t: { type: 'DATABASE_ERROR' } | null = null;\n    return databaseFailure('f', error);\n  }"
    ),
    // prose
    wrap(
      "catch (error) {\n    // failure({ type: 'DATABASE_ERROR' })\n    /* type: 'DATABASE_ERROR' */\n    log(\"type: 'DATABASE_ERROR'\", `type: 'DATABASE_ERROR'`);\n    return databaseFailure('f', error);\n  }"
    ),
    // allowlisted file
    {
      code: wrap(
        "catch (error) {\n    return failure({ type: 'DATABASE_ERROR', operation: 'f' });\n  }"
      ),
      filename: '/w/src/domain/x/special.helper.ts',
      options: [{ allow: ['src/domain/x/special.helper.ts'] }],
    },
  ],
  invalid: [
    {
      code: wrap(
        "catch (error) {\n    reportIssueBackend({ error });\n    return failure({ type: 'DATABASE_ERROR', operation: 'f' });\n  }"
      ),
      errors: inline,
    },
    {
      code: wrap(
        "catch (e: unknown) {\n    if (isP2002(e)) {\n      return failure({ type: 'DATABASE_ERROR', operation: 'f' });\n    }\n    throw e;\n  }"
      ),
      errors: inline,
    },
    {
      code: wrap(
        'catch (error) {\n    return failure({ type: "DATABASE_ERROR", operation: \'f\' });\n  }'
      ),
      errors: inline,
    },
    {
      code: wrap(
        "catch (error) {\n    return failure({ type: `DATABASE_ERROR`, operation: 'f' });\n  }"
      ),
      errors: inline,
    },
    {
      code: wrap(
        "catch (error) {\n    return failure({ 'type': 'DATABASE_ERROR' as const, operation: 'f' });\n  }"
      ),
      errors: inline,
    },
    // a const holding the string
    {
      code:
        "const DB = 'DATABASE_ERROR' as const;\n" +
        wrap(
          "catch (error) {\n    return failure({ type: DB, operation: 'f' });\n  }"
        ),
      errors: inline,
    },
    // databaseFailure elsewhere in the catch does not excuse the inline literal
    {
      code: wrap(
        "catch (error) {\n    if (x) { return databaseFailure('f', error); }\n    return failure({ type: 'DATABASE_ERROR', operation: 'f' });\n  }"
      ),
      errors: inline,
    },
    // a callback inside the catch still closes over the error
    {
      code: wrap(
        "catch (error) {\n    return retry(() => failure({ type: 'DATABASE_ERROR', operation: 'f' }));\n  }"
      ),
      errors: inline,
    },
    // binding-less catch: the error is lost entirely
    {
      code: wrap(
        "catch {\n    return failure({ type: 'DATABASE_ERROR', operation: 'f' });\n  }"
      ),
      errors: [{ messageId: 'swallowed' }],
    },
  ],
});
