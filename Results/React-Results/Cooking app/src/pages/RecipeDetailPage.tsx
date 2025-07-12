import { useEffect } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { useRecipeStore } from '@/store/recipeStore';
import Tag from '@/components/ui/Tag';
import Spinner from '@/components/ui/Spinner';
import PlaceholderImage from '@/assets/placeholder.svg';

const RecipeDetailPage = () => {
  const { recipeId } = useParams<{ recipeId: string }>();
  const { recipes, isLoading, fetchRecipes, initialized } = useRecipeStore(
    (state) => ({
      recipes: state.recipes,
      isLoading: state.isLoading,
      fetchRecipes: state.fetchRecipes,
      initialized: state.initialized,
    })
  );

  useEffect(() => {
    if (!initialized) {
      fetchRecipes();
    }
  }, [initialized, fetchRecipes]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner />
      </div>
    );
  }

  const recipe = recipes.find((r) => r.id === recipeId);

  if (!recipe) {
    // After loading is complete, if recipe is not found, redirect to 404.
    // This check prevents a flash of "not found" before data is loaded.
    if (!isLoading && initialized) {
       return <Navigate to="/404" replace />;
    }
    // If still loading or not initialized, we show nothing until the check is done.
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <article className="bg-white rounded-lg shadow-lg overflow-hidden">
        <img
          src={recipe.imageUrl || PlaceholderImage}
          alt={recipe.title}
          className="w-full h-64 md:h-96 object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.onerror = null; 
            target.src = PlaceholderImage;
          }}
        />
        <div className="p-6 md:p-8">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-4">{recipe.title}</h1>
          
          <div className="flex flex-wrap gap-2 mb-6">
            {recipe.tags.map((tag) => (
              <Tag key={tag} label={tag} />
            ))}
             <span className="text-sm text-gray-500 self-center ml-2">• {recipe.duration} minutes</span>
          </div>
          
          <p className="text-gray-600 text-lg mb-8">{recipe.description}</p>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
            <div className="md:col-span-2">
              <h2 className="text-2xl font-semibold text-gray-700 mb-4 border-b-2 border-green-500 pb-2">Ingredients</h2>
              <ul className="list-disc list-inside space-y-2 text-gray-700">
                {recipe.ingredients.map((ingredient, index) => (
                  <li key={index}>{ingredient.quantity} {ingredient.name}</li>
                ))}
              </ul>
            </div>
            
            <div className="md:col-span-3">
              <h2 className="text-2xl font-semibold text-gray-700 mb-4 border-b-2 border-green-500 pb-2">Instructions</h2>
              <ol className="list-decimal list-inside space-y-4 text-gray-700">
                {recipe.instructions.map((instruction, index) => (
                  <li key={index} className="pl-2">{instruction}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </article>
      <div className="text-center mt-8">
        <Link to="/recipes" className="text-green-600 hover:text-green-800 font-semibold">
          &larr; Back to all recipes
        </Link>
      </div>
    </div>
  );
};

export default RecipeDetailPage;

// --- FILE: