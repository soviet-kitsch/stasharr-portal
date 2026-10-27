import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AcquisitionScenesQueryDto } from './acquisition-scenes-query.dto';

describe('AcquisitionScenesQueryDto', () => {
  it('accepts acquisition lifecycle values', async () => {
    const instance = plainToInstance(AcquisitionScenesQueryDto, {
      lifecycle: 'IMPORT_PENDING',
    });

    await expect(validate(instance)).resolves.toHaveLength(0);
  });

  it('rejects lifecycle states outside the acquisition page scope', async () => {
    const instance = plainToInstance(AcquisitionScenesQueryDto, {
      lifecycle: 'AVAILABLE',
    });

    const errors = await validate(instance);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isIn');
  });
  it.each(['REQUESTED', 'IMPORT_PENDING'])(
    'accepts the Select all page size for %s and rejects the old oversized request',
    async (lifecycle) => {
      await expect(
        validate(
          plainToInstance(AcquisitionScenesQueryDto, {
            lifecycle,
            page: '1',
            perPage: '50',
          }),
        ),
      ).resolves.toHaveLength(0);
      const errors = await validate(
        plainToInstance(AcquisitionScenesQueryDto, {
          lifecycle,
          page: '1',
          perPage: '100',
        }),
      );
      expect(
        errors.some(
          (error) => error.property === 'perPage' && error.constraints?.max,
        ),
      ).toBe(true);
    },
  );
});
