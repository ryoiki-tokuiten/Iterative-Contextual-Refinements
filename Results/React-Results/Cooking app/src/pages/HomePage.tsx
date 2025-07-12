import React from 'react';
import { RecipeList } from '@/features/recipe-list/RecipeList';
import { RecipeSearch } from '@/features/recipe-search/RecipeSearch';
import { useRecipeStore } from '@/store/recipeStore';

const HomePage: React.FC = () => {
  const filteredRecipes = useRecipeStore((state) => state.filteredRecipes);
  const featuredRecipes = filteredRecipes.filter((recipe) => recipe.isFeatured);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-800 mb-4">
          Welcome to React Recipes
        </h1>
        <p className="text-lg text-gray-600">
          Find your next favorite meal.
        </p>
      </div>
      
      <RecipeSearch />

      <h2 className="text-2xl font-bold text-gray-700 mb-6 border-b-2 border-orange-500 pb-2">
        Featured Recipes
      </h2>
      <RecipeList recipes={featuredRecipes} />
    </div>
  );
};

export default HomePage;
