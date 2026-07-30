import { Reflector } from '@nestjs/core';
import { CatalogController } from '../catalog/catalog.controller';
import { Roles } from './roles.decorator';

describe('Roles metadata', () => {
  const reflector = new Reflector();

  it('lets a handler override the controller', () => {
    expect(
      reflector.getAllAndOverride(Roles, [
        CatalogController.prototype.remove,
        CatalogController,
      ]),
    ).toEqual(['admin']);
  });

  it('falls back to the controller when the handler has none', () => {
    expect(
      reflector.getAllAndOverride(Roles, [
        CatalogController.prototype.findAll,
        CatalogController,
      ]),
    ).toEqual(['viewer']);
  });
});
