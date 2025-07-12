import { Recipe } from '@/types';
import { mockRecipes } from '@/data/mockRecipes';

const SIMULATED_LATENCY = 500; // ms

/**
 * Simulates fetching all recipes from an API.
 * @returns A promise that resolves to an array of all recipes.
 */
export const getAllRecipes = (): Promise<Recipe[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(mockRecipes);
    }, SIMULATED_LATENCY);
  });
};

/**
 * Simulates fetching a single recipe by its ID from an API.
 * @param id - The ID of the recipe to fetch.
 * @returns A promise that resolves to the recipe object or undefined if not found.
 */
export const getRecipeById = (id: string): Promise<Recipe | undefined> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const recipe = mockRecipes.find((r) => r.id === id);
      resolve(recipe);
    }, SIMULATED_LATENCY);
  });
};