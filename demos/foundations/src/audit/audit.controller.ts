import { Controller, Get } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('demo')
  async demo(): Promise<{ events: string[] }> {
    this.audit.record('start');
    await new Promise((resolve) => setTimeout(resolve, 50)); // simulate I/O
    this.audit.record('end');
    return { events: this.audit.flush() };
  }
}
