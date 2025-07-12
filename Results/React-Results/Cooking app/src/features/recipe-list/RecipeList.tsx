import React from 'react';
import { useRecipeStore } from '@/store/recipeStore';
import { Recipe } from '@/types';
import Card from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';

interface RecipeListProps {
  recipes: Recipe[];
}

export const RecipeList: React.FC<RecipeListProps> = ({ recipes }) => {
  const isLoading = useRecipeStore((state) => state.isLoading);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner />
      </div>
    );
  }

  if (recipes.length === 0) {
    return (
      <div className="text-center py-10">
        <p className="text-gray-500">No recipes found. Try a different search!</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
      {recipes.map((recipe) => (
        <Card
          key={recipe.id}
          title={recipe.title}
          imageUrl={recipe.imageUrl}
          description={recipe.description}
        />
      ))}
    </div>
  );
};