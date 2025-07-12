import { create } from 'zustand';
import { Recipe } from '@/types';
import * as recipeService from '@/services/recipeService';

interface RecipeState {
  recipes: Recipe[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  filteredRecipes: Recipe[];
  getRecipeById: (id: string) => Recipe | undefined;
  fetchRecipes: () => Promise<void>;
  setSearchQuery: (query: string) => void;
}

export const useRecipeStore = create<RecipeState>((set, get) => ({
  recipes: [],
  isLoading: false,
  error: null,
  searchQuery: '',

  /**
   * A derived state selector that returns recipes filtered by the search query.
   * It checks against the recipe title and ingredients.
   */
  get filteredRecipes() {
    const { recipes, searchQuery } = get();
    if (!searchQuery) {
      return recipes;
    }
    const lowerCaseQuery = searchQuery.toLowerCase().trim();
    return recipes.filter(
      (recipe) =>
        recipe.title.toLowerCase().includes(lowerCaseQuery) ||
        recipe.tags?.some((tag) => tag.toLowerCase().includes(lowerCaseQuery)) ||
        recipe.ingredients.some((ing) => ing.name.toLowerCase().includes(lowerCaseQuery))
    );
  },

  /**
   * Finds a recipe by its ID from the currently loaded list in the store.
   * @param id The ID of the recipe to find.
   * @returns The recipe object or undefined if not found.
   */
  getRecipeById: (id: string) => {
    return get().recipes.find((recipe) => recipe.id === id);
  },

  /**
   * Fetches all recipes from the service and updates the store state.
   * Manages loading and error states.
   */
  fetchRecipes: async () => {
    // Prevent re-fetching if recipes are already loaded
    if (get().recipes.length > 0) {
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const recipes = await recipeService.getAllRecipes();
      set({ recipes, isLoading: false });
    } catch (e) {
      const error = e instanceof Error ? e.message : 'An unknown error occurred.';
      set({ error: `Failed to fetch recipes: ${error}`, isLoading: false });
    }
  },

  /**
   * Updates the search query in the store.
   * @param query The new search string.
   */
  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },
}));