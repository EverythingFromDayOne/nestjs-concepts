import { ExecutionContext } from '@nestjs/common';

export function httpContext(options: {
  request?: unknown;
  response?: unknown;
  handler?: Function;
  cls?: Function;
  type?: string;
}): ExecutionContext {
  const { request = {}, response = {}, handler = () => undefined, cls = class {}, type = 'http' } = options;
  return {
    getType: () => type,
    getArgs: () => [request, response, () => undefined],
    getArgByIndex: (i: number) => [request, response, () => undefined][i],
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response, getNext: () => () => undefined }),
    switchToWs: () => ({ getClient: () => request, getData: () => response, getPattern: () => '' }),
    switchToRpc: () => ({ getData: () => request, getContext: () => response }),
  } as unknown as ExecutionContext;
}
