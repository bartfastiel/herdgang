// The nutrition table (nutrition/bls.json, about 0.6 MB, hashed by the build) is loaded once, when the first recipe
// needs it; the service worker keeps it for offline use.
import { foodTable, type FoodFile, type FoodTable } from './recipe/nutrition.ts';

declare const __BLS__: string;

let table: FoodTable | null = null;
let loading: Promise<FoodTable | null> | null = null;

/** the table if it is already loaded (for synchronous use, e.g. the PDF) */
export const foodsNow = (): FoodTable | null => table;

export function loadFoods(): Promise<FoodTable | null> {
  if (!loading) {
    loading = fetch(__BLS__)
      .then((r) => (r.ok ? (r.json() as Promise<FoodFile>) : null))
      .then((f) => (table = f ? foodTable(f) : null))
      .catch(() => {
        loading = null;
        return null;
      });
  }
  return loading;
}
