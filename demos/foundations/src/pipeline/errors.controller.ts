import { Controller, ForbiddenException, Get, HttpException, HttpStatus } from '@nestjs/common';
import { RawResponse } from './raw-response.decorator';

@RawResponse()
@Controller('errors')
export class ErrorsController {
  @Get('http')
  http(): never {
    throw new ForbiddenException('nope');
  }

  @Get('object')
  object(): never {
    throw new HttpException({ code: 'ORDER_LOCKED', orderId: 42 }, HttpStatus.CONFLICT);
  }

  @Get('unknown')
  unknown(): never {
    throw new Error('something broke');
  }
}
