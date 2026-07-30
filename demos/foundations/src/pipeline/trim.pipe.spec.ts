import { ArgumentMetadata } from '@nestjs/common';
import { TrimPipe } from './trim.pipe';

const meta = (type: ArgumentMetadata['type'], data?: string): ArgumentMetadata =>
  ({ type, data, metatype: String });

describe('TrimPipe', () => {
  const pipe = new TrimPipe();

  it('trims query strings', () => {
    expect(pipe.transform('  a  ', meta('query', 'q'))).toBe('a');
  });

  it('names the field when blank', () => {
    expect(() => pipe.transform('   ', meta('param', 'id'))).toThrow(/id/);
  });

  it('leaves bodies untouched', () => {
    const body = { name: '  a  ' };
    expect(pipe.transform(body, meta('body'))).toBe(body);
  });
});
