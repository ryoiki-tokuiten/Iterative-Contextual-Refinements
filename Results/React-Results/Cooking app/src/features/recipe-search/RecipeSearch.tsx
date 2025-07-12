import React, { useState, useEffect } from 'react';
import Input from '@/components/ui/Input';
import { useDebounce } from '@/hooks/useDebounce';
import { useRecipeStore } from '@/store/recipeStore';

export const RecipeSearch: React.FC = () => {
  const { searchQuery, setSearchQuery } = useRecipeStore((state) => ({
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery,
  }));

  const [localQuery, setLocalQuery] = useState(searchQuery);
  const debouncedQuery = useDebounce(localQuery, 300);

  useEffect(() => {
    setSearchQuery(debouncedQuery);
  }, [debouncedQuery, setSearchQuery]);
  
  // Sync local state if global state changes from elsewhere
  useEffect(() => {
    if (searchQuery !== localQuery) {
      setLocalQuery(searchQuery);
    }
  }, [searchQuery]);


  return (
    <div className="mb-8">
      <Input
        type="text"
        placeholder="Search for recipes..."
        value={localQuery}
        onChange={(e) => setLocalQuery(e.target.value)}
        className="w-full max-w-lg mx-auto"
      />
    </div>
  );
};