// Probe for the forbidUnknownValues seed vs class-validator's own default.
// nestjs-concepts has no verify/ convention yet, so this sits beside the
// articles that cite it. Run from a throwaway directory:
//
//   npm i @nestjs/common@11.2.1 class-validator@0.15.1 class-transformer@0.5.1 reflect-metadata@0.2.2 rxjs
//   node /path/to/forbid-unknown-values.mjs
//
// Expected against those pins:
//   new ValidationPipe()                           -> false
//   new ValidationPipe({forbidUnknownValues:true}) -> true
//   1. ValidationPipe(), no options         : ACCEPTED
//   2. ValidationPipe({forbidUnknown:true}) : REJECTED
//   3. class-validator validate(), no opts  : REJECTED
//   4. class-validator, explicit false      : ACCEPTED

import { createRequire } from 'node:module';

// .mjs is ESM; the appendix is CommonJS. createRequire keeps the probe body intact.
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { ValidationPipe } = require('@nestjs/common');
const { validate } = require('class-validator');

// A DTO whose validation metadata is empty — no decorators applied.
// This is the exact shape class-validator 0.14+ rejects under forbidUnknownValues.
class BareDto {}

const meta = { type: 'body', metatype: BareDto, data: '' };
const payload = { anything: 'at all' };

async function viaPipe(label, opts) {
  const pipe = new ValidationPipe(opts);
  try {
    await pipe.transform(payload, meta);
    return `${label}: ACCEPTED`;
  } catch (e) {
    const r = e.getResponse ? e.getResponse() : e.message;
    return `${label}: REJECTED -> ${JSON.stringify(r.message ?? r)}`;
  }
}

async function viaRaw(label, opts) {
  const inst = Object.assign(new BareDto(), payload);
  const errs = await validate(inst, opts);
  return errs.length
    ? `${label}: REJECTED -> ${JSON.stringify(errs.map(e => e.constraints))}`
    : `${label}: ACCEPTED`;
}

(async () => {
  console.log('nest', require('@nestjs/common/package.json').version,
              '| class-validator', require('class-validator/package.json').version);
  console.log('');
  console.log('-- what the pipe resolves forbidUnknownValues to --');
  console.log('  new ValidationPipe()                          ->',
    new ValidationPipe().validatorOptions.forbidUnknownValues);
  console.log('  new ValidationPipe({forbidUnknownValues:true})->',
    new ValidationPipe({ forbidUnknownValues: true }).validatorOptions.forbidUnknownValues);
  console.log('');
  console.log('-- observable behaviour --');
  console.log(' ', await viaPipe('1. ValidationPipe(), no options      ', undefined));
  console.log(' ', await viaPipe('2. ValidationPipe({forbidUnknown:true})', { forbidUnknownValues: true }));
  console.log(' ', await viaRaw ('3. class-validator validate(), no opts', undefined));
  console.log(' ', await viaRaw ('4. class-validator, explicit false    ', { forbidUnknownValues: false }));
})();
