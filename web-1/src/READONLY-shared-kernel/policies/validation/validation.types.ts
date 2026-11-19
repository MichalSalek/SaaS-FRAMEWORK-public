export type ValidationFlag = {
  __isValid: boolean;
};

export type GenericValidationResult = Record<string, unknown>;

/**
 * DECISION: a validator's verdict is a discriminated union on `__isValid`. Success carries the
 * PARSER'S OUTPUT in `__data` (trimmed, coerced, defaulted, unknown keys stripped); failure carries
 * none. The middleware hands a handler `__data` and nothing else, so a handler can never read a
 * field the validator did not check, and a transform (`.trim()`, `z.coerce`, `.default()`) is
 * what the handler sees. Typing the data is `z.output` of the schema (not `z.input`): handlers
 * consume the result of the transforms, callers send the input shape. Do not reintroduce a path
 * that passes the request body itself to a handler.
 */
export type ValidationOutcome<TData> =
  { __isValid: true; __data: TData } | { __isValid: false; __data?: never };

export type ValidationResult<TData = unknown> = ValidationOutcome<TData> &
  GenericValidationResult;

/** Strips the verdict and the parsed payload, leaving only the per-field error DTO. */
export const getErrorDTOWithoutValidationFlag = (
  validationResult: GenericValidationResult & ValidationFlag
): GenericValidationResult => {
  const { __isValid, __data, ...cleaned } = validationResult;
  return cleaned;
};

export type ValidationFunction<TData = unknown> = (
  data: unknown
) => ValidationResult<TData>;

declare const noPayloadBrand: unique symbol;

/**
 * Payload of an endpoint that reads nothing from the request body (runtime value: `{}`).
 *
 * DECISION: branded, not `Record<string, never>`. An index signature of `never` is assignable to any
 * all-optional request type, so `NO_VALIDATION` compiled on a handler declaring `{ cursor?: string }`
 * and that handler silently received `{}` for fields it believed it had. The brand is a property no
 * request type has, so TypeScript's weak-type check rejects that pairing: a bodyless handler must
 * declare `NoPayload` (or a bodyless `undefined` REQUEST, mapped by HandlerPayload).
 */
export type NoPayload = { readonly [noPayloadBrand]?: never };

/**
 * For endpoints that read no request body (GET handlers reading `req.query`, bodyless
 * session-derived commands). The handler receives an empty object, never the request body.
 */
export const NO_VALIDATION: ValidationFunction<NoPayload> = () => ({
  __isValid: true,
  __general: '',
  __data: {},
});

/**
 * The payload type a handler receives for a declared REQUEST type: a bodyless REQUEST
 * (`undefined`) becomes `NoPayload`, because the handler receives `{}` from NO_VALIDATION.
 */
export type HandlerPayload<TRequest> = [TRequest] extends [undefined]
  ? NoPayload
  : TRequest;
