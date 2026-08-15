import {injectable} from 'inversify';

const CACHE_TTL_MS = 30000;
const FETCH_TIMEOUT_MS = 5000;
let cache: { key: string; data: any[]; expiry: number } | null = null;

@injectable()
export class InventoryService {
  public async lookupInventory(productName?: string, brandId?: string, category?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (brandId) params.set('brandId', brandId);
    if (productName) params.set('productName', productName);

    const query = params.toString();
    const url = `${process.env.PRODUCTS_API_BASE_URL}/products${query ? `?${query}` : ''}`;

    const now = Date.now();
    if (cache && cache.key === url && now < cache.expiry) {
      return cache.data;
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const products: any[] = await res.json();
      cache = { key: url, data: products, expiry: now + CACHE_TTL_MS };
      return products;
    } catch (err) {
      console.error('lookupInventory failed:', err);
      return [];
    }
  }
}
