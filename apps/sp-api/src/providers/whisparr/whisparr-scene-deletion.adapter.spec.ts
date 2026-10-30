import { WhisparrSceneDeletionAdapter } from './whisparr-scene-deletion.adapter';
import { fetchWithTimeout } from '../fetch-with-timeout';
jest.mock('../fetch-with-timeout', () => ({ fetchWithTimeout: jest.fn() }));
const fetchMock = fetchWithTimeout as jest.Mock;
const config = {
  baseUrl: 'http://whisparr.invalid/prefix',
  apiKey: 'synthetic',
};
describe('native Whisparr deletion transport', () => {
  const adapter = new WhisparrSceneDeletionAdapter();
  beforeEach(() => fetchMock.mockReset());
  it('uses the native file-deletion option without an import exclusion and accepts empty 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await adapter.deleteSceneAndFiles(42, config);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.pathname).toBe('/prefix/api/v3/movie/42');
    expect(url.searchParams.get('deleteFiles')).toBe('true');
    expect(url.searchParams.get('addImportExclusion')).toBe('false');
    expect(options.method).toBe('DELETE');
    expect(options.redirect).toBe('error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('explicitly disables file deletion when removing an entry only', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await adapter.deleteSceneEntry(42, config);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url.pathname).toBe('/prefix/api/v3/movie/42');
    expect(url.searchParams.get('deleteFiles')).toBe('false');
    expect(url.searchParams.get('addImportExclusion')).toBe('false');
    expect(options.method).toBe('DELETE');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not retry entry-only deletion after an uncertain response', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(adapter.deleteSceneEntry(42, config)).rejects.toThrow(
      'did not confirm',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('never retries an uncertain response', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(adapter.deleteSceneAndFiles(42, config)).rejects.toThrow(
      'did not confirm',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('blocks a queued scene', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ totalRecords: 1, records: [{ id: 1, movieId: 42 }] }),
      );
    await expect(adapter.assertIdle(42, config)).rejects.toThrow('queued');
  });
  it('blocks global in-progress commands', async () => {
    fetchMock.mockResolvedValue(
      Response.json([{ status: 'started', body: {} }]),
    );
    await expect(adapter.assertIdle(42, config)).rejects.toThrow(
      'global scope',
    );
  });
  it('rejects incomplete queue pagination', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(
        Response.json({ totalRecords: 2, records: [{ id: 1, movieId: 43 }] }),
      )
      .mockResolvedValueOnce(Response.json({ totalRecords: 2, records: [] }));
    await expect(adapter.assertIdle(42, config)).rejects.toThrow(
      'pagination is incomplete',
    );
  });
  it('allows only a complete idle queue', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ totalRecords: 0, records: [] }));
    await expect(adapter.assertIdle(42, config)).resolves.toBeUndefined();
  });
  it('rejects file records belonging to another scene', async () => {
    fetchMock.mockResolvedValue(
      Response.json([
        { id: 7, movieId: 99, path: '/wrong', size: 1, dateAdded: 'today' },
      ]),
    );
    await expect(adapter.files(42, config)).rejects.toThrow('incomplete');
  });
});
