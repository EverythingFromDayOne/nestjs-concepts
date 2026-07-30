import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class TrimPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'param' || metadata.type === 'query') {
      if (typeof value !== 'string') {
        return value;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException(`${metadata.data ?? 'value'} must not be blank`);
      }
      return trimmed;
    }
    return value;                        // leave bodies alone
  }
}
