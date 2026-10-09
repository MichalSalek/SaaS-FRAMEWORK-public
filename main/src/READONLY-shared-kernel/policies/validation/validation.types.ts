export type ValidationFlag = {
  __isValid: boolean;
};

export type GenericValidationResult = Record<string, unknown>;

export const getErrorDTOWithoutValidationFlag = (
  validationResult: GenericValidationResult & ValidationFlag
): GenericValidationResult => {
  const { __isValid, ...cleaned } = validationResult;
  return cleaned;
};

export type ValidationFunction = (
  data: unknown
) => ValidationFlag & GenericValidationResult;

/** Passthrough validation for endpoints that don't require body validation (e.g. GET handlers) */
export const NO_VALIDATION: ValidationFunction = () => ({ __isValid: true });
