// Records of a cookbook. All stores sync through /api/records; deleting leaves a tombstone ({id, deleted: true}).
//
// A recipe is a list of revisions, like commits on a single branch: each revision is immutable and holds the complete
// source text (src/recipe/format.ts) plus a message, its author and its parent. The version number is the position in
// the list ordered by creation time. Comments (feedback) belong to one revision.

export interface Base {
  id: string;
  /** set on every local change (sync: the newer change wins) */
  updated?: number;
  deleted?: boolean;
}

export interface Author {
  id: string;
  name: string;
}

export interface RecipeRec extends Base {
  created: number;
  createdBy: Author;
}

export interface Revision extends Base {
  recipeId: string;
  parentId: string | null;
  source: string;
  /** what changed and why, like a commit message */
  message: string;
  author: Author;
  created: number;
}

export interface Comment extends Base {
  recipeId: string;
  revisionId: string;
  text: string;
  author: Author;
  created: number;
  /** time of the last edit */
  edited?: number;
}

/**
 * Which food of the nutrition table an ingredient stands for in this cookbook, chosen by hand
 * (src/recipe/nutrition.ts). id = folded ingredient name; code '' = not counted.
 */
export interface FoodChoice extends Base {
  name: string;
  code: string;
  author: Author;
  created: number;
}
