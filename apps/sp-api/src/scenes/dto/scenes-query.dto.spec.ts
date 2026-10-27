import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ScenesQueryDto } from './scenes-query.dto';
import { PerformersQueryDto } from '../../performers/dto/performers-query.dto';

describe('Discovery filter query validation', () => {
  it('accepts comma and repeated performer values and trims them', async () => {
    const dto = plainToInstance(ScenesQueryDto, {
      performerIds: ['p-1, p-2', ' p-3 '],
    });
    expect(dto.performerIds).toEqual(['p-1', 'p-2', 'p-3']);
    expect(await validate(dto)).toEqual([]);
  });
  it('rejects oversized lists and non-string performer values', async () => {
    for (const performerIds of [Array(21).fill('p'), [12], ['x'.repeat(101)]]) {
      expect(
        (await validate(plainToInstance(ScenesQueryDto, { performerIds })))
          .length,
      ).toBeGreaterThan(0);
    }
  });
  it('accepts genuine popularity and a single trimmed studio, rejecting arrays', async () => {
    const dto = plainToInstance(PerformersQueryDto, {
      sort: 'POPULARITY',
      studioId: ' studio-1 ',
    });
    expect(dto.studioId).toBe('studio-1');
    expect(await validate(dto)).toEqual([]);
    expect(
      (
        await validate(
          plainToInstance(PerformersQueryDto, {
            studioId: ['studio-1', 'studio-2'],
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
