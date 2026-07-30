import { Inject, Injectable, Optional } from '@nestjs/common';
import { NotificationTransport } from './notification-transport.interface';
import { NOTIFICATION_TRANSPORT, METRICS_SINK } from './notification.tokens';

export interface MetricsSink {
  increment(metric: string): void;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_TRANSPORT)
    private readonly transport: NotificationTransport,
    @Optional()
    @Inject(METRICS_SINK)
    private readonly metrics?: MetricsSink,
  ) {}

  async send(to: string, body: string): Promise<void> {
    await this.transport.deliver(to, body);
    this.metrics?.increment('notifications.sent');
  }
}
