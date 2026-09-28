export const ADMIN_API_VERSION =
  '1';

export const ADMIN_API_VERSION_HEADER =
  'X-DTPStat-API-Version';

export const ADMIN_API_RELOAD_CODE =
  'api_client_reload_required';

export function adminApiHeaders(
  headers = {},
) {
  return {
    ...headers,
    [ADMIN_API_VERSION_HEADER]:
      ADMIN_API_VERSION,
  };
}
