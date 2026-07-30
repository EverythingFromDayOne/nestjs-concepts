import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { TraceService } from './trace.service';

@Injectable()
export class TracePipe implements PipeTransform {
  constructor(private readonly trace: TraceService) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    this.trace.mark(`pipe (${metadata.type})`);
    if (value === 'invalid') {
      throw new BadRequestException('rejected by TracePipe');
    }
    return value;
  }
}
