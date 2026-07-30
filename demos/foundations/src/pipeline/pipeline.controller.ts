import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { TinyCacheInterceptor } from './cache.interceptor';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateItemInterface } from './dto/create-item.interface';
import { ErrorLogInterceptor } from './error-log.interceptor';
import { NaiveGuard } from './naive.guard';
import { RawResponse } from './raw-response.decorator';
import { ResilienceInterceptor } from './resilience.interceptor';
import { TimingInterceptor } from './timing.interceptor';
import { TraceFilter } from './trace.filter';
import { TracePipe } from './trace.pipe';
import { TraceService } from './trace.service';
import { TrimPipe } from './trim.pipe';

@RawResponse()
@UseFilters(TraceFilter)
@UseInterceptors(
  TimingInterceptor,
  ErrorLogInterceptor,
  TinyCacheInterceptor,
  ResilienceInterceptor,
)
@Controller('pipeline')
export class PipelineController {
  constructor(private readonly trace: TraceService) {}

  @Get()
  run(@Query('value', TracePipe) value?: string): { trace: string[]; value?: string } {
    this.trace.mark('handler');
    return { trace: this.trace.drain(), value };
  }

  @UseGuards(ApiKeyGuard)
  @Get('protected')
  protected(): { ok: true } {
    return { ok: true };
  }

  @UseGuards(NaiveGuard)
  @Get('naive')
  naive(): { ok: true } {
    return { ok: true };
  }

  @Get('page')
  page(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ): { page: number } {
    return { page };
  }

  @Get('page-reversed')
  pageReversed(
    @Query('page', ParseIntPipe, new DefaultValuePipe(1)) page: number,
  ): { page: number } {
    return { page };
  }

  @Post('items-interface')
  itemsInterface(@Body() body: CreateItemInterface): CreateItemInterface {
    return body;
  }

  @Post('items-dto')
  itemsDto(@Body() body: CreateItemDto): CreateItemDto {
    return body;
  }

  @Get('cached')
  cached(): { at: number } {
    // eslint-disable-next-line no-console
    console.log('cached handler entered');
    return { at: Date.now() };
  }

  @Get('slow')
  async slow(): Promise<{ ok: true }> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { ok: true };
  }

  @Get('trim/:id')
  trim(@Param('id', TrimPipe) id: string): { id: string } {
    return { id };
  }
}
