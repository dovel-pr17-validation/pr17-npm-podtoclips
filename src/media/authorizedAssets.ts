export type AuthenticatedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const resolveApiUrl = (apiBase: string, url: string) => url.startsWith('/api/')
  ? `${apiBase.replace(/\/api$/, '')}${url}`
  : url;

export const requestAuthorizedAssetUrl = async (
  authFetch: AuthenticatedFetch,
  apiBase: string,
  assetKey: string,
  options: { download?: boolean } = {},
) => {
  const endpoint = options.download ? 'download-access' : 'access';
  const response = await authFetch(`${apiBase}/assets/${endpoint}/${encodeURIComponent(assetKey)}`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.url) throw new Error(data?.error || 'This media asset is not available.');
  return resolveApiUrl(apiBase, data.url);
};

export const downloadAuthorizedAsset = async (
  authFetch: AuthenticatedFetch,
  apiBase: string,
  assetKey: string,
  downloadName: string,
) => {
  const url = await requestAuthorizedAssetUrl(authFetch, apiBase, assetKey, { download: true });
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = downloadName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return url;
};
