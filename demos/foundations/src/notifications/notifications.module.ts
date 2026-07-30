import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationTransport } from './notification-transport.interface';
import { NOTIFICATION_TRANSPORT } from './notification.tokens';
import { BufferedTransport } from './transports/buffered.transport';
import { ConsoleTransport } from './transports/console.transport';

@Module({
  imports: [ConfigModule],
  providers: [
    NotificationsService,
    ConsoleTransport,
    BufferedTransport,
    {
      provide: NOTIFICATION_TRANSPORT,
      useFactory: (
        config: ConfigService,
        consoleTransport: ConsoleTransport,
        bufferedTransport: BufferedTransport,
      ): NotificationTransport =>
        config.get('NOTIFY_MODE') === 'buffer'
          ? bufferedTransport
          : consoleTransport,
      inject: [ConfigService, ConsoleTransport, BufferedTransport],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
