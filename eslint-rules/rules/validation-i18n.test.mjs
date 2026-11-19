import guard from './validation-i18n.mjs';
import { createRuleTester } from '../rule-tester.mjs';

const tester = createRuleTester();
const error = [{ messageId: 'literal' }];

tester.run('nf/validation-i18n', guard.rule, {
  valid: [
    // the correct forms: a V.* key, glue, a variable
    "returnObject.email += V.user.emailInvalid + ' ';",
    "returnObject.id += idErrorMessage + ' ';",
    "fields[slot] = (fields[slot] ?? '') + issue.message + ' ';",
    'returnObject.name += `${V.user.nameTooLong} `;',
    // a counter and an unrelated assignment
    'stats.count += 1;',
    "returnObject.__isValid = hasError(returnObject);",
    "label.text = 'Name';",
    // prose: line comment, block comment
    "// returnObject.email += 'Email must be valid';\nconst a = 1;",
    "/* returnObject.x += 'Bad' */\nconst a = 1;",
  ],
  invalid: [
    // the two forms of the shell guard
    { code: "returnObject.email += 'Email must be valid';", errors: error },
    { code: "returnObject.email +=\n  'Email must be valid';", errors: error },
    { code: 'returnObject.email += "Email must be valid";', errors: error },
    { code: 'returnObject.email += `Email must be valid`;', errors: error },
    // forms the grep did not see
    { code: "errors.email += 'Email must be valid';", errors: error },
    { code: "returnObject['email'] += 'Email must be valid';", errors: error },
    { code: "returnObject.email += V.user.x + ' and also too long';", errors: error },
    { code: 'returnObject.email += `${field} must be valid`;', errors: error },
    { code: "returnObject.email += ok ? '' : 'Invalid';", errors: error },
    { code: "fields[slot] = (fields[slot] ?? '') + 'Invalid value';", errors: error },
  ],
});
