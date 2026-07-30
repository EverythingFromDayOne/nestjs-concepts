import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AccessLogMiddleware } from './access-log.middleware';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ApiKeyGuard } from './api-key.guard';
import { TinyCacheInterceptor } from './cache.interceptor';
import { CorrelationIdMiddleware } from './correlation-id.middleware';
import { EnvelopeInterceptor } from './envelope.interceptor';
import { ErrorLogInterceptor } from './error-log.interceptor';
import { ErrorsController } from './errors.controller';
import { NaiveGuard } from './naive.guard';
import { noCache } from './no-cache.middleware';
import { PipelineController } from './pipeline.controller';
import { ResilienceInterceptor } from './resilience.interceptor';
import { RolesGuard } from './roles.guard';
import { TimingInterceptor } from './timing.interceptor';
import { TraceFilter } from './trace.filter';
import { TraceGuard } from './trace.guard';
import { TraceInterceptor } from './trace.interceptor';
import { TraceMiddleware } from './trace.middleware';
import { TracePipe } from './trace.pipe';
import { TraceService } from './trace.service';
import { TrimPipe } from './trim.pipe';
import { TransportAwareApiKeyGuard } from './transport-aware-api-key.guard';

@Module({
  controllers: [PipelineController, ErrorsController],
  providers: [
    TraceService,
    TracePipe,
    TraceFilter,
    TraceMiddleware,
    CorrelationIdMiddleware,
    AccessLogMiddleware,
    ApiKeyGuard,
    NaiveGuard,
    RolesGuard,
    TransportAwareApiKeyGuard,
    TimingInterceptor,
    ErrorLogInterceptor,
    TinyCacheInterceptor,
    ResilienceInterceptor,
    TrimPipe,
    EnvelopeInterceptor,
    AllExceptionsFilter,
    { provide: APP_GUARD, useClass: TraceGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TraceInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class PipelineModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware, AccessLogMiddleware, TraceMiddleware, noCache)
      .exclude({ path: 'pipeline/health', method: RequestMethod.GET })
      .forRoutes('pipeline{/*splat}');
  }
}
