import { Injectable, OnModuleInit } from '@nestjs/common';

@Injectable()
export class SecondService implements OnModuleInit {
  onModuleInit(): void {
    // eslint-disable-next-line no-console
    console.log('Second done');
  }
}
