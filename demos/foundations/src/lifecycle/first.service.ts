import { Injectable, OnModuleInit } from '@nestjs/common';

@Injectable()
export class FirstService implements OnModuleInit {
  private ready = false;
  private readonly readyWaiters: Array<() => void> = [];

  async onModuleInit(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    // eslint-disable-next-line no-console
    console.log('First done');
    this.ready = true;
    for (const resolve of this.readyWaiters.splice(0)) {
      resolve();
    }
  }

  whenReady(): Promise<void> {
    if (this.ready) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  isReady(): boolean {
    return this.ready;
  }
}
