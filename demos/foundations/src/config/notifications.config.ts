import { registerAs } from '@nestjs/config';

export default registerAs('notifications', () => ({
  mode: process.env.NOTIFY_MODE === 'buffer' ? ('buffer' as const) : ('console' as const),
  retries: Number(process.env.NOTIFY_RETRIES ?? 3),
}));
