import React from 'react';
import { RecipeList } from '@/features/recipe-list/RecipeList';
import { RecipeSearch } from '@/features/recipe-search/RecipeSearch';
import { useRecipeStore } from '@/store/recipeStore';

const RecipesPage: React.FC = () => {
  const filteredRecipes = useRecipeStore((state) => state.filteredRecipes);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-8 text-center">
        Explore All Recipes
      </h1>
      
      <RecipeSearch />
      
      <RecipeList recipes={filteredRecipes} />
    </div>
  );
};

export default RecipesPage;
