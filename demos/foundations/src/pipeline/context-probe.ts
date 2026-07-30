import { Logger } from '@nestjs/common';

export function describeHandler(label: string, ctx: unknown): void {
  const candidate = ctx as { getHandler?: () => Function | null; getClass?: () => Function | null };
  const handler = candidate.getHandler?.() ?? null;
  const cls = candidate.getClass?.() ?? null;

  new Logger('context').log(
    `${label}: class=${cls?.name ?? 'none'} handler=${handler?.name ?? 'none'}`,
  );
}
