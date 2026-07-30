import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../common/roles.decorator';
import { CatalogService, Product } from './catalog.service';

@Roles(['viewer'])
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  findAll(): Product[] {
    return this.catalog.findAll();
  }

  @Get('featured')
  findFeatured(): Product[] {
    return this.catalog.findFeatured();
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  exportCsv(@Res({ passthrough: true }) res: Response): string {
    res.setHeader('X-Row-Count', String(this.catalog.findAll().length));
    return this.catalog.toCsv();
  }

  @Get('docs/{*splat}')
  docsIncludingRoot(@Param('splat') splat: string[] = []): string {
    return `docs: ${splat.join('/')}`;
  }

  @Get(':id')
  findOne(@Param('id') id: string): Product {
    return this.catalog.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body('name') name: string): Product {
    return this.catalog.create(name);
  }

  @Roles(['admin'])
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.catalog.remove(id);
  }
}
