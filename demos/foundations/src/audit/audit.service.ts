import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class AuditService {
  private readonly events: string[] = [];

  record(event: string): void {
    this.events.push(event);
  }

  flush(): string[] {
    const collected = [...this.events];
    this.events.length = 0;
    return collected;
  }
}
