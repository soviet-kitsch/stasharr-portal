import { BadGatewayException, Logger } from '@nestjs/common';
import { RuntimeHealthService } from '../../runtime-health/runtime-health.service';
import { WhisparrAdapter } from './whisparr.adapter';

describe('WhisparrAdapter', () => {
  let adapter: WhisparrAdapter;
  let runtimeHealthService: {
    recordSuccess: jest.Mock;
    recordFailure: jest.Mock;
  };
  let originalFetch: typeof fetch;
  const fetchMock = jest.fn();

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    runtimeHealthService = {
      recordSuccess: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    adapter = new WhisparrAdapter(
      runtimeHealthService as unknown as RuntimeHealthService,
    );
  });

  it('exposes actual imported file evidence while keeping catalog identity checks', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 42,
          stashId: 'scene-1',
          hasFile: true,
          path: '/library/root',
          movieFile: { path: '/library/root/video.mkv', size: 123456 },
        },
      ],
    });
    await expect(
      adapter.findMovieByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      }),
    ).resolves.toEqual({
      movieId: 42,
      stashId: 'scene-1',
      hasFile: true,
      filePath: '/library/root/video.mkv',
      fileSize: 123456,
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 42,
          stashId: 'different-scene',
          hasFile: true,
          movieFile: { path: '/library/root/video.mkv', size: 123456 },
        },
      ],
    });
    await expect(
      adapter.findMovieByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      }),
    ).resolves.toBeNull();
  });

  it.each([
    undefined,
    { size: -1 },
    { size: 0 },
    { size: 1.5 },
    { size: '123' },
  ])(
    'does not invent file evidence from the movie root or invalid size %#',
    async (movieFile) => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 42,
            stashId: 'scene-1',
            hasFile: true,
            path: '/library/root',
            movieFile,
          },
        ],
      });
      const result = await adapter.findMovieByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      });
      expect(result).not.toHaveProperty('filePath');
      expect(result).not.toHaveProperty('fileSize');
    },
  );

  it('builds safe browser links under a reverse proxy prefix', () => {
    expect(
      adapter.buildSceneViewUrl('https://media.example/whisparr/', 42),
    ).toBe('https://media.example/whisparr/movie/42');
    expect(
      adapter.buildSceneViewUrl(
        'http://user:secret@whisparr/prefix?apikey=secret#private',
        42,
      ),
    ).toBe('http://whisparr/prefix/movie/42');
  });

  describe('search commands', () => {
    it('sends the native MoviesSearch command for exactly one existing movie', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 7 }) });
      expect(
        await adapter.searchMovie(42, { baseUrl: 'http://whisparr.local' }),
      ).toEqual({ commandId: 7 });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://whisparr.local/api/v3/command',
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        name: 'MoviesSearch',
        movieIds: [42],
      });
    });

    it('requires a confirmed command identifier', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
      await expect(
        adapter.searchMovie(42, { baseUrl: 'http://whisparr.local' }),
      ).rejects.toThrow('confirm a search command');
    });

    it('rejects malformed search-command snapshots', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [{ id: 7, name: 'MoviesSearch', status: 'started' }],
      });
      await expect(
        adapter.getSearchCommands({ baseUrl: 'http://whisparr.local' }),
      ).rejects.toThrow('incomplete search-command snapshot');
    });
  });

  describe('complete snapshot safety', () => {
    it.each([
      [{ id: 1, stashId: 'a', hasFile: true }, { id: 2 }],
      [
        { id: 1, stashId: 'a', hasFile: true },
        { id: 1, stashId: 'b', hasFile: false },
      ],
      [
        { id: 1, stashId: 'a', hasFile: true },
        { id: 2, stashId: 'a', hasFile: false },
      ],
      [{ id: 1, stashId: 'a' }],
    ])(
      'rejects an invalid or ambiguous full movie snapshot %#',
      async (...records) => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => records });
        await expect(
          adapter.getMovieSnapshot({ baseUrl: 'http://whisparr.local' }),
        ).rejects.toThrow(BadGatewayException);
        expect(runtimeHealthService.recordFailure).toHaveBeenCalled();
      },
    );

    it('rejects a partial movie collection wrapper', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          totalRecords: 2,
          records: [{ id: 1, stashId: 'a', hasFile: true }],
        }),
      });
      await expect(
        adapter.getMovieSnapshot({ baseUrl: 'http://whisparr.local' }),
      ).rejects.toThrow('partial snapshot');
    });

    it('accepts a valid empty movie snapshot', async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
      await expect(
        adapter.getMovieSnapshot({ baseUrl: 'http://whisparr.local' }),
      ).resolves.toEqual([]);
    });

    it('rejects an unexpectedly empty page before the queue is complete', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ totalRecords: 1, records: [] }),
      });
      await expect(
        adapter.getQueueSnapshot({ baseUrl: 'http://whisparr.local' }),
      ).rejects.toThrow('before all records');
    });
  });

  describe('findMovieByStashId', () => {
    it('returns null for empty result array', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toBeNull();
    });

    it('normalizes movie lookup payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 42,
              stashId: 'scene-1',
              hasFile: true,
            },
          ]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local/base',
          apiKey: 'secret',
        }),
      ).resolves.toEqual({
        movieId: 42,
        stashId: 'scene-1',
        hasFile: true,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://whisparr.local/base/api/v3/movie?stashId=scene-1',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Api-Key': 'secret',
          },
          signal: expect.any(AbortSignal),
        }),
      );
      expect(runtimeHealthService.recordSuccess).toHaveBeenCalledWith(
        'WHISPARR',
      );
    });

    it('rejects malformed lookup entries instead of inferring absence', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: null, stashId: 'scene-1', hasFile: true },
            { id: 1, hasFile: true },
            { id: 2, stashId: 'other-scene', hasFile: true },
            { id: 3, stashId: 'scene-1', hasFile: false },
          ]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toThrow('lookup is incomplete');
    });

    it('throws and logs for multiple movie matches', async () => {
      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, stashId: 'scene-1', hasFile: false },
            { id: 2, stashId: 'scene-1', hasFile: true },
          ]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);

      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('throws BadGatewayException for malformed non-array payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ not: 'an array' }),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('throws BadGatewayException when fetch fails', async () => {
      fetchMock.mockRejectedValue(new Error('network failure'));

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
      expect(runtimeHealthService.recordFailure).toHaveBeenCalledWith(
        'WHISPARR',
        expect.any(Error),
      );
    });
  });

  describe('findMovieById', () => {
    it('normalizes movie-by-id payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 42,
            stashId: 'scene-1',
            hasFile: true,
          }),
      } as Response);

      await expect(
        adapter.findMovieById(42, {
          baseUrl: 'http://whisparr.local/base',
          apiKey: 'secret',
        }),
      ).resolves.toEqual({
        movieId: 42,
        stashId: 'scene-1',
        hasFile: true,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://whisparr.local/base/api/v3/movie/42',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-Api-Key': 'secret',
          },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('returns null when movie-by-id payload cannot be normalized', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 42,
            hasFile: true,
          }),
      } as Response);

      await expect(
        adapter.findMovieById(42, {
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toBeNull();
    });

    it('throws for unexpected movie-by-id payload shape', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(['not-an-object']),
      } as Response);

      await expect(
        adapter.findMovieById(42, {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('getQueueSnapshot', () => {
    it('normalizes queue payload with records wrapper and filters malformed entries', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            page: 1,
            pageSize: 10,
            records: [
              {
                movieId: 100,
                status: 'downloading',
                trackedDownloadState: 'downloading',
                trackedDownloadStatus: 'ok',
                errorMessage: null,
              },
              {
                movie: { id: 101 },
                status: 'warning',
                trackedDownloadState: 'ImportPending',
                trackedDownloadStatus: 'Warning',
                errorMessage: 'The download is stalled with no connections',
              },
              {
                movie: {},
                status: 'completed',
                trackedDownloadState: 'Downloading',
              },
              {
                status: 'queued',
                trackedDownloadState: 'Downloading',
              },
            ],
            totalRecords: 4,
          }),
      } as Response);

      await expect(
        adapter.getQueueSnapshot({
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual([
        {
          movieId: 100,
          status: 'downloading',
          trackedDownloadState: 'downloading',
          trackedDownloadStatus: 'ok',
          errorMessage: null,
        },
        {
          movieId: 101,
          status: 'warning',
          trackedDownloadState: 'ImportPending',
          trackedDownloadStatus: 'Warning',
          errorMessage: 'The download is stalled with no connections',
        },
      ]);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://whisparr.local/api/v3/queue?page=1&pageSize=50',
        expect.any(Object),
      );
    });

    it('pages through queue until totalRecords is collected', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              page: 1,
              pageSize: 50,
              totalRecords: 3,
              records: [
                {
                  movieId: 200,
                  status: 'downloading',
                  trackedDownloadState: 'downloading',
                  trackedDownloadStatus: 'ok',
                  errorMessage: null,
                },
                {
                  movieId: 201,
                  status: 'completed',
                  trackedDownloadState: 'Importing',
                  trackedDownloadStatus: 'ok',
                  errorMessage: null,
                },
              ],
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              page: 2,
              pageSize: 50,
              totalRecords: 3,
              records: [
                {
                  movieId: 202,
                  status: 'warning',
                  trackedDownloadState: 'ImportPending',
                  trackedDownloadStatus: 'ok',
                  errorMessage: 'Temporary provider failure',
                },
              ],
            }),
        } as Response);

      await expect(
        adapter.getQueueSnapshot({
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual([
        {
          movieId: 200,
          status: 'downloading',
          trackedDownloadState: 'downloading',
          trackedDownloadStatus: 'ok',
          errorMessage: null,
        },
        {
          movieId: 201,
          status: 'completed',
          trackedDownloadState: 'Importing',
          trackedDownloadStatus: 'ok',
          errorMessage: null,
        },
        {
          movieId: 202,
          status: 'warning',
          trackedDownloadState: 'ImportPending',
          trackedDownloadStatus: 'ok',
          errorMessage: 'Temporary provider failure',
        },
      ]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'http://whisparr.local/api/v3/queue?page=1&pageSize=50',
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'http://whisparr.local/api/v3/queue?page=2&pageSize=50',
        expect.any(Object),
      );
    });
  });

  describe('request workflow methods', () => {
    it('normalizes root folders', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, path: '/media/a', accessible: true },
            { id: 2, path: '/media/b', accessible: false },
            { id: 3, accessible: true },
          ]),
      } as Response);

      await expect(
        adapter.getRootFolders({
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual([
        { id: 1, path: '/media/a', accessible: true },
        { id: 2, path: '/media/b', accessible: false },
      ]);
    });

    it('normalizes quality profiles', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([{ id: 10, name: 'Default' }, { id: 11 }]),
      } as Response);

      await expect(
        adapter.getQualityProfiles({
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual([{ id: 10, name: 'Default' }]);
    });

    it('normalizes tags', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 50, label: 'VR' },
            { id: 51, label: '' },
          ]),
      } as Response);

      await expect(
        adapter.getTags({
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual([{ id: 50, label: 'VR' }]);
    });

    it('submits create movie payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 777,
          }),
      } as Response);

      await expect(
        adapter.createMovie(
          {
            title: 'Scene title',
            studio: 'Scene studio',
            foreignId: 'scene-1',
            monitored: true,
            rootFolderPath: '/media/a',
            addOptions: { searchForMovie: true },
            qualityProfileId: 10,
            tags: [50],
          },
          {
            baseUrl: 'http://whisparr.local',
            apiKey: 'secret',
          },
        ),
      ).resolves.toEqual({ movieId: 777 });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://whisparr.local/api/v3/movie',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Api-Key': 'secret',
          },
          body: JSON.stringify({
            title: 'Scene title',
            studio: 'Scene studio',
            foreignId: 'scene-1',
            monitored: true,
            rootFolderPath: '/media/a',
            addOptions: { searchForMovie: true },
            qualityProfileId: 10,
            tags: [50],
          }),
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('throws for malformed create movie response payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(['unexpected']),
      } as Response);

      await expect(
        adapter.createMovie(
          {
            title: 'Scene title',
            studio: 'Scene studio',
            foreignId: 'scene-1',
            monitored: true,
            rootFolderPath: '/media/a',
            addOptions: { searchForMovie: true },
            qualityProfileId: 10,
            tags: [],
          },
          {
            baseUrl: 'http://whisparr.local',
          },
        ),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  it('builds scene view URL for deep-linking', () => {
    expect(adapter.buildSceneViewUrl('http://whisparr.local/base/', 1234)).toBe(
      'http://whisparr.local/base/movie/1234',
    );
  });
});
