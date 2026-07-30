import { Injectable } from '@nestjs/common';

@Injectable()
export class TraceService {
  private readonly steps: string[] = [];

  mark(step: string): void {
    this.steps.push(step);
  }

  drain(): string[] {
    const collected = [...this.steps];
    this.steps.length = 0;
    return collected;
  }
}
