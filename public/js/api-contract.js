export const DTPSTAT_API_VERSION =
  '1';

export const DTPSTAT_API_VERSION_HEADER =
  'X-DTPStat-API-Version';

export const DTPSTAT_API_RELOAD_CODE =
  'api_client_reload_required';

export function dtpstatApiHeaders(
  headers = {},
) {
  return {
    ...headers,
    [DTPSTAT_API_VERSION_HEADER]:
      DTPSTAT_API_VERSION,
  };
}
