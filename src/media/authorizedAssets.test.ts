import { describe, expect, it, vi } from 'vitest';
import { requestAuthorizedAssetUrl } from './authorizedAssets';

describe('authorized asset access', () => {
  it('requests a user-authorized preview URL without putting an auth token in the media URL', async () => {
    const authFetch = vi.fn(async () => new Response(JSON.stringify({ url: 'https://signed.example/video.mp4?signature=safe' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const url = await requestAuthorizedAssetUrl(authFetch, 'https://api.example/api', 'renders/account-a/clip.mp4');

    expect(authFetch).toHaveBeenCalledWith('https://api.example/api/assets/access/renders%2Faccount-a%2Fclip.mp4');
    expect(url).toBe('https://signed.example/video.mp4?signature=safe');
  });

  it('uses the separate download authorization endpoint and fails closed on denial', async () => {
    const authFetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Asset not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(requestAuthorizedAssetUrl(authFetch, '/api', 'private.mp4', { download: true })).rejects.toThrow('Asset not found');
    expect(authFetch).toHaveBeenCalledWith('/api/assets/download-access/private.mp4');
  });
});
