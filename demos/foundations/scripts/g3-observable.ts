import { lastValueFrom, of } from 'rxjs';

async function main(): Promise<void> {
  const result = await lastValueFrom(of(true, false));
  console.log('G3_lastValueFrom', result);
}

void main();
