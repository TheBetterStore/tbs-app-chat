import {injectable} from "inversify";

@injectable()
export class InventoryService {
  public async lookupInventory(productName?: string, brandId?: string, category?: string): Promise<any[]> {
    const res = await fetch(`${process.env.PRODUCTS_API_BASE_URL}/products`);
    let products: any[] = await res.json();
    if (category) {
      const cat = category.toUpperCase();
      products = products.filter((p) => (p.category || '').toUpperCase() === cat);
    }
    if (brandId) {
      const brand = brandId.toLowerCase();
      products = products.filter((p) => (p.brandId || p.productDetails?.brandId || '').toLowerCase() === brand);
    }
    if (productName) {
      const search = productName.toLowerCase();
      products = products.filter((p) => p.name.toLowerCase().includes(search));
    }
    return products;
  }
}
