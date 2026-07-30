import { Injectable } from '@nestjs/common';
import { NotificationTransport } from '../notification-transport.interface';

@Injectable()
export class BufferedTransport implements NotificationTransport {
  private readonly outbox: Array<{ to: string; body: string }> = [];

  async deliver(to: string, body: string): Promise<void> {
    this.outbox.push({ to, body });
  }

  drain(): ReadonlyArray<{ to: string; body: string }> {
    return this.outbox;
  }
}
