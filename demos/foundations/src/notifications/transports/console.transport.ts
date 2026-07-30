import { Injectable } from '@nestjs/common';
import { NotificationTransport } from '../notification-transport.interface';

@Injectable()
export class ConsoleTransport implements NotificationTransport {
  async deliver(to: string, body: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[console] to=${to} body=${body}`);
  }
}
