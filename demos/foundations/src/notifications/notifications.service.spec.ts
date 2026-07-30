import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_TRANSPORT } from './notification.tokens';

describe('NotificationsService', () => {
  it('delegates delivery to the configured transport', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NOTIFICATION_TRANSPORT, useValue: { deliver } },
      ],
    }).compile();

    await moduleRef.get(NotificationsService).send('a@b.c', 'hi');

    expect(deliver).toHaveBeenCalledWith('a@b.c', 'hi');
  });
});
