import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

const RateLimit = Reflector.createDecorator<{ limit: number; window?: number }>();

@RateLimit({ limit: 100, window: 60 })
@Controller('merge-check')
class MergeCheckController {
  @RateLimit({ limit: 10 })
  @Get()
  list(): void {}
}

describe('Reflector.getAllAndMerge object precedence', () => {
  const reflector = new Reflector();

  it('lets class metadata win with [handler, controller]', () => {
    expect(
      reflector.getAllAndMerge(RateLimit, [
        MergeCheckController.prototype.list,
        MergeCheckController,
      ]),
    ).toEqual({ limit: 100, window: 60 });
  });

  it('lets handler metadata win when targets are reversed', () => {
    expect(
      reflector.getAllAndMerge(RateLimit, [
        MergeCheckController,
        MergeCheckController.prototype.list,
      ]),
    ).toEqual({ limit: 10, window: 60 });
  });
});
