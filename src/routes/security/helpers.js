import {
  AdminSecurityValidationError,
} from '../../modules/security/policy.js';

export function parsePositiveInteger(value) {
  const number = Number(value);

  return (
    Number.isSafeInteger(number) &&
    number > 0
  )
    ? number
    : null;
}

export function handleAdminSecurityValidation(
  response,
  error,
) {
  if (
    !(
      error instanceof
      AdminSecurityValidationError
    )
  ) {
    return false;
  }

  response
    .status(400)
    .json({
      error: error.message,
    });

  return true;
}
