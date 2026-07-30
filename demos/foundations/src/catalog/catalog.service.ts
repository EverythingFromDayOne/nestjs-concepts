import { Injectable, NotFoundException } from '@nestjs/common';

export interface Product {
  id: string;
  name: string;
  featured: boolean;
}

@Injectable()
export class CatalogService {
  private readonly products: Product[] = [
    { id: '1', name: 'Desk lamp', featured: true },
    { id: '2', name: 'Notebook', featured: false },
  ];

  findAll(): Product[] {
    return this.products;
  }

  findFeatured(): Product[] {
    return this.products.filter((product) => product.featured);
  }

  findOne(id: string): Product {
    const product = this.products.find((candidate) => candidate.id === id);
    if (!product) {
      throw new NotFoundException(`No product with id ${id}`);
    }
    return product;
  }

  create(name: string): Product {
    const product: Product = { id: String(this.products.length + 1), name, featured: false };
    this.products.push(product);
    return product;
  }

  remove(id: string): void {
    const index = this.products.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      throw new NotFoundException(`No product with id ${id}`);
    }
    this.products.splice(index, 1);
  }

  toCsv(): string {
    const rows = this.products.map((p) => `${p.id},${p.name},${p.featured}`);
    return ['id,name,featured', ...rows].join('\n');
  }
}
