import { Inject, Injectable, Scope } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class ContextualLogger {
  private readonly source: string;

  constructor(@Inject(INQUIRER) parentClass: object) {
    this.source = parentClass?.constructor?.name ?? 'unknown';
  }

  log(message: string): void {
    console.log(`[${this.source}] ${message}`);
  }
}
